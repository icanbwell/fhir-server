const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest, getTestContainer } = require('../common');
const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');
const { MockK8sClient } = require('./mocks/k8sClient');

describe('ExportStatus stored document', () => {
    beforeEach(async () => {
        process.env.ENABLE_BULK_EXPORT = '1';
        await commonBeforeEach();
    });

    afterEach(async () => {
        process.env.ENABLE_BULK_EXPORT = '0';
        await commonAfterEach();
    });

    const createExport = async () => {
        const request = await createTestRequest((c) => {
            c.register('k8sClient', (c) => new MockK8sClient({ configManager: c.configManager }));
            return c;
        });
        const resp = await request
            .post('/4_0_0/Patient/$export?_type=Patient')
            .set(getHeaders())
            .expect(202);
        const exportStatusId = resp.headers['content-location'].split('/').pop();
        const db = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
        return { request, exportStatusId, collection: db.collection('ExportStatus_4_0_0') };
    };

    test('a new export is stored with its request, internal fields and empty entry arrays', async () => {
        const { exportStatusId, collection } = await createExport();

        const stored = await collection.findOne({ _uuid: exportStatusId });

        expect(stored.resourceType).toStrictEqual('ExportStatus');
        expect(stored.request).toStrictEqual('http://localhost:3000/4_0_0/Patient/$export?_type=Patient');
        expect(stored.status).toStrictEqual('accepted');
        expect(stored.requiresAccessToken).toStrictEqual(false);
        expect(stored._uuid).toStrictEqual(exportStatusId);
        expect(stored._sourceId).toStrictEqual(exportStatusId);
        expect(stored._sourceAssigningAuthority).toStrictEqual('bwell');
        expect(stored._access).toBeUndefined();
        expect(stored._id).toBeDefined();
        expect(stored.output).toStrictEqual([]);
        expect(stored.errors).toStrictEqual([]);
        expect(stored.meta.versionId).toStrictEqual('1');
        expect(stored.meta.lastUpdated).toBeInstanceOf(Date);
        expect(stored.requestUrl).toBeUndefined();
        expect(stored.extension).toBeUndefined();
    });

    test('an admin update keeps the stored request and internal fields and bumps the version', async () => {
        const { request, exportStatusId, collection } = await createExport();
        const before = await collection.findOne({ _uuid: exportStatusId });

        const putResp = await request
            .put(`/admin/ExportStatus/${exportStatusId}`)
            .set(getHeaders('admin/*.* user/*.* access/*.*'))
            .send({
                resourceType: 'ExportStatus',
                id: exportStatusId,
                meta: { source: before.meta.source, security: before.meta.security },
                status: 'in-progress'
            })
            .expect(200);

        expect(putResp.body._uuid).toBeUndefined();
        expect(putResp.body._access).toBeUndefined();
        expect(putResp.body.request).toStrictEqual(before.request);
        expect(putResp.body.status).toStrictEqual('in-progress');
        expect(putResp.body.output).toStrictEqual([]);
        expect(putResp.body.errors).toStrictEqual([]);

        const after = await collection.findOne({ _uuid: exportStatusId });
        expect(after.status).toStrictEqual('in-progress');
        expect(after.request).toStrictEqual(before.request);
        expect(after._uuid).toStrictEqual(before._uuid);
        expect(after._id).toStrictEqual(before._id);
        expect(after.meta.versionId).toStrictEqual('2');
        expect(after.output).toStrictEqual([]);
        expect(after.errors).toStrictEqual([]);
    });

    test.each([
        ['no meta', () => ({})],
        ['no owner tag', (before) => ({ meta: { source: before.meta.source, security: [] } })]
    ])('an admin update with %s is rejected and leaves the stored document unchanged', async (_name, metaFor) => {
        const { request, exportStatusId, collection } = await createExport();
        const before = await collection.findOne({ _uuid: exportStatusId });

        const putResp = await request
            .put(`/admin/ExportStatus/${exportStatusId}`)
            .set(getHeaders('admin/*.* user/*.* access/*.*'))
            .send({ resourceType: 'ExportStatus', id: exportStatusId, status: 'in-progress', ...metaFor(before) });

        expect(putResp.status).toStrictEqual(400);
        expect(putResp.body.issue[0].diagnostics).toStrictEqual('Validation Failed');
        const after = await collection.findOne({ _uuid: exportStatusId });
        expect(after).toStrictEqual(before);
    });

    test('an admin update without meta.source keeps the stored source', async () => {
        const { request, exportStatusId, collection } = await createExport();
        const before = await collection.findOne({ _uuid: exportStatusId });

        await request
            .put(`/admin/ExportStatus/${exportStatusId}`)
            .set(getHeaders('admin/*.* user/*.* access/*.*'))
            .send({
                resourceType: 'ExportStatus',
                id: exportStatusId,
                meta: { security: before.meta.security },
                status: 'in-progress'
            })
            .expect(200);

        const after = await collection.findOne({ _uuid: exportStatusId });
        expect(after.status).toStrictEqual('in-progress');
        expect(after.meta.source).toStrictEqual(before.meta.source);
    });

    test('admin search with _elements projects ExportStatus properties', async () => {
        const { request, exportStatusId } = await createExport();

        const resp = await request
            .get('/admin/ExportStatus?_elements=id,status')
            .set(getHeaders('admin/*.* user/*.* access/*.*'))
            .expect(200);

        expect(resp.body.entry).toHaveLength(1);
        expect(resp.body.entry[0].resource.id).toStrictEqual(exportStatusId);
        expect(resp.body.entry[0].resource.status).toStrictEqual('accepted');
        expect(resp.body.entry[0].resource.request).toBeUndefined();
    });

    test('admin search with an unknown _elements property is rejected', async () => {
        const { request } = await createExport();

        await request
            .get('/admin/ExportStatus?_elements=notAProperty')
            .set(getHeaders('admin/*.* user/*.* access/*.*'))
            .expect(400);
    });

    test('an admin update runs its after-save handlers when the client sends x-request-id', async () => {
        const { request, exportStatusId, collection } = await createExport();
        const before = await collection.findOne({ _uuid: exportStatusId });
        const postSaveProcessor = getTestContainer().postSaveProcessor;
        const afterSave = jest.spyOn(postSaveProcessor, 'afterSaveAsync');
        afterSave.mockClear();

        await request
            .put(`/admin/ExportStatus/${exportStatusId}`)
            .set(getHeaders('admin/*.* user/*.* access/*.*'))
            .set('x-request-id', 'client-sent-request-id')
            .send({
                resourceType: 'ExportStatus',
                id: exportStatusId,
                meta: { source: before.meta.source, security: before.meta.security },
                status: 'in-progress'
            })
            .expect(200);

        expect(afterSave).toHaveBeenCalledWith(
            expect.objectContaining({ eventType: 'U', resourceType: 'ExportStatus' })
        );
        afterSave.mockRestore();
    });
});
