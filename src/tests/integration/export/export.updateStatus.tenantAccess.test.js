const exportStatus1Resource = require('./fixtures/exportStatus/exportStatus1.json');

const deepcopy = require('deepcopy');
const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest, getTestContainer } = require('../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { MockK8sClient } = require('./mocks/k8sClient');

const OWNER_SYSTEM = 'https://www.icanbwell.com/owner';
const ACCESS_SYSTEM = 'https://www.icanbwell.com/access';

const buildTenantExportStatus = (accessCodes) => {
    const resource = deepcopy(exportStatus1Resource);
    resource.meta.lastUpdated = new Date();
    resource.meta.security = [
        { system: OWNER_SYSTEM, code: 'bwell' },
        { system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'bwell' },
        ...accessCodes.map((code) => ({ system: ACCESS_SYSTEM, code }))
    ];
    return resource;
};

const accessCodesOf = (resource) =>
    resource.meta.security.filter((s) => s.system === ACCESS_SYSTEM).map((s) => s.code);

describe('Update ExportStatus tenant access Tests', () => {
    beforeEach(async () => {
        process.env.ENABLE_BULK_EXPORT = '1';
        await commonBeforeEach();
    });

    afterEach(async () => {
        process.env.ENABLE_BULK_EXPORT = '0';
        await commonAfterEach();
    });

    const insertExportStatusAsync = async (resource) => {
        const request = await createTestRequest((c) => {
            c.register('k8sClient', (c) => new MockK8sClient({ configManager: c.configManager }));
            return c;
        });
        const fhirDb = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
        const result = await fhirDb.collection('ExportStatus_4_0_0').insertOne(deepcopy(resource));
        expect(result.acknowledged).toEqual(true);
        return request;
    };

    const readStoredExportStatusAsync = async (id) => {
        const fhirDb = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
        return fhirDb.collection('ExportStatus_4_0_0').findOne({ id });
    };

    test('caller whose access scopes cover the ExportStatus owner and access tags can update it', async () => {
        const exportStatus = buildTenantExportStatus(['tenantA']);
        const request = await insertExportStatusAsync(exportStatus);

        const body = deepcopy(exportStatus);
        body.status = 'in-progress';

        await request
            .put(`/admin/ExportStatus/${exportStatus.id}`)
            .set(getHeaders('admin/*.* user/*.* access/bwell.* access/tenantA.*'))
            .send(body)
            .expect(200);

        const stored = await readStoredExportStatusAsync(exportStatus.id);
        expect(stored.status).toEqual('in-progress');
    });

    test('caller whose access scope is for another tenant gets 403 and the ExportStatus is unchanged', async () => {
        const exportStatus = buildTenantExportStatus(['tenantA']);
        const request = await insertExportStatusAsync(exportStatus);

        const body = deepcopy(exportStatus);
        body.status = 'in-progress';

        await request
            .put(`/admin/ExportStatus/${exportStatus.id}`)
            .set(getHeaders('admin/*.* user/*.* access/tenantB.*'))
            .send(body)
            .expect(403);

        const stored = await readStoredExportStatusAsync(exportStatus.id);
        expect(stored.status).toEqual('accepted');
    });

    test('caller cannot re-tag the ExportStatus into a tenant it has no access scope for', async () => {
        const exportStatus = buildTenantExportStatus(['tenantA']);
        const request = await insertExportStatusAsync(exportStatus);

        const body = buildTenantExportStatus(['tenantA', 'tenantB']);
        body.id = exportStatus.id;
        body.status = 'in-progress';

        await request
            .put(`/admin/ExportStatus/${exportStatus.id}`)
            .set(getHeaders('admin/*.* user/*.* access/bwell.* access/tenantA.*'))
            .send(body)
            .expect(403);

        const stored = await readStoredExportStatusAsync(exportStatus.id);
        expect(stored.status).toEqual('accepted');
        expect(accessCodesOf(stored)).toEqual(['tenantA']);
    });
});
