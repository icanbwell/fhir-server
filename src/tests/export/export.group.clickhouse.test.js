// test file
const { describe, beforeAll, afterAll, beforeEach, afterEach, test, expect } = require('@jest/globals');

const { commonBeforeEach, commonAfterEach, createTestRequest, getHeaders, getTestContainer } = require('../common');
const { BulkDataExportRunner } = require('../../operations/export/script/bulkDataExportRunner');
const { MockK8sClient } = require('./mocks/k8sClient');
const { MockS3Client } = require('./mocks/s3Client');
const { generateUUID } = require('../../utils/uid.util');
const { ConfigManager } = require('../../utils/configManager');
const { ClickHouseClientManager } = require('../../utils/clickHouseClientManager');
const { USE_EXTERNAL_STORAGE_HEADER } = require('../../utils/contextDataBuilder');

// ClickHouse Group storage must be enabled for the hybrid roster path. Read lazily
// by ConfigManager getters, so setting here (before container creation) is enough.
process.env.ENABLE_CLICKHOUSE = '1';
process.env.MONGO_WITH_CLICKHOUSE_RESOURCES = 'Group';
process.env.CLICKHOUSE_WRITE_MODE = 'sync';
process.env.CLICKHOUSE_DATABASE = 'fhir';

// $merge requires a uuid id or owner/sourceAssigningAuthority security tags.
const bwellTags = [
    { system: 'https://www.icanbwell.com/owner', code: 'bwell' },
    { system: 'https://www.icanbwell.com/access', code: 'bwell' }
];

let clickHouseManager;

/**
 * S3 mock that also retains multipart part data so tests can read exported NDJSON.
 * The shared MockS3Client discards multipart parts; the Patient export path uses them.
 */
class CapturingS3Client extends MockS3Client {
    partsByPath = {};

    async uploadPartAsync({ filePath, data }) {
        (this.partsByPath[filePath] = this.partsByPath[filePath] || []).push(data.toString('utf-8'));
    }

    getResourcesForPublicPath(publicPath) {
        // publicPath is s3://<bucket>/<filePath>; strip the scheme + bucket
        const filePath = publicPath.replace(`s3://${this.bucketName}/`, '');
        const parts = this.partsByPath[filePath];
        if (!parts) {
            return [];
        }
        return parts
            .join('\n')
            .split('\n')
            .filter(line => line.trim().length > 0)
            .map(line => JSON.parse(line));
    }
}

/**
 * Force ClickHouse to merge parts so the current-state MVs reflect just-written events.
 */
async function syncMaterializedViews() {
    await clickHouseManager.queryAsync({ query: 'OPTIMIZE TABLE fhir.Group_4_0_0_MemberCurrentByEntity FINAL' });
    await clickHouseManager.queryAsync({ query: 'OPTIMIZE TABLE fhir.Group_4_0_0_MemberCurrent FINAL' });
}

async function truncateClickHouse() {
    for (const table of [
        'Group_4_0_0_MemberCurrentByEntity',
        'Group_4_0_0_MemberCurrent',
        'Group_4_0_0_MemberEvents'
    ]) {
        try {
            await clickHouseManager.truncateTableAsync(table);
        } catch (e) {
            // ignore missing tables
        }
    }
    await syncMaterializedViews();
}

/**
 * Runs a full Group export cycle and returns { body, s3Client }.
 */
async function runGroupExport(request, groupId, { scope } = {}) {
    const headers = scope ? getHeaders(scope) : getHeaders();

    let resp = await request
        .get(`/4_0_0/Group/${groupId}/$export`)
        .set(headers)
        .expect(202);

    expect(resp.headers['content-location']).toBeDefined();
    const exportStatusId = resp.headers['content-location'].split('/').pop();

    resp = await request
        .get(`/4_0_0/$export/${exportStatusId}`)
        .set(getHeaders())
        .expect(202);
    expect(resp.headers['x-progress']).toEqual('accepted');

    const container = getTestContainer();
    const postRequestProcessor = container.postRequestProcessor;
    const postSaveProcessor = container.postSaveProcessor;
    const requestId = generateUUID();
    const s3Client = new CapturingS3Client({ bucketName: 'test', region: 'test' });

    // Force a fresh runner instance (the container caches resolved services).
    delete container.services.bulkDataExportRunner;
    container.register('bulkDataExportRunner', (c) => new BulkDataExportRunner({
        databaseQueryFactory: c.databaseQueryFactory,
        databaseExportManager: c.databaseExportManager,
        patientFilterManager: c.patientFilterManager,
        databaseAttachmentManager: c.databaseAttachmentManager,
        r4SearchQueryCreator: c.r4SearchQueryCreator,
        patientQueryCreator: c.patientQueryCreator,
        enrichmentManager: c.enrichmentManager,
        resourceLocatorFactory: c.resourceLocatorFactory,
        r4ArgsParser: c.r4ArgsParser,
        searchManager: c.searchManager,
        postSaveProcessor: c.postSaveProcessor,
        bulkExportEventProducer: c.bulkExportEventProducer,
        storageProviderFactory: c.storageProviderFactory,
        exportStatusId,
        patientReferenceBatchSize: 1000,
        uploadPartSize: 1024 * 1024,
        s3Client,
        requestId
    }));

    await container.bulkDataExportRunner.processAsync();
    await postRequestProcessor.executeAsync({ requestId });
    await postSaveProcessor.flushAsync();

    resp = await request
        .get(`/4_0_0/$export/${exportStatusId}`)
        .set(getHeaders())
        .expect(200);

    return { body: resp.body, s3Client };
}

/**
 * Reads exported resources of a type from the completed export body via the capturing mock.
 */
function exportedResources({ body, s3Client }, resourceType) {
    const entry = body.output.find(o => o.type === resourceType);
    if (!entry) {
        return [];
    }
    return s3Client.getResourcesForPublicPath(entry.url);
}

describe('Group Export Tests', () => {
    beforeAll(() => {
        clickHouseManager = new ClickHouseClientManager({ configManager: new ConfigManager() });
    });

    afterAll(async () => {
        if (clickHouseManager) {
            await clickHouseManager.closeAsync();
        }
    });

    beforeEach(async () => {
        process.env.ENABLE_BULK_EXPORT = '1';
        const container = getTestContainer();
        if (container) {
            delete container.services.bulkDataExportRunner;
        }
        await commonBeforeEach();
        await truncateClickHouse();
    });

    afterEach(async () => {
        process.env.ENABLE_BULK_EXPORT = '0';
        await commonAfterEach();
    });

    test('Hybrid Group export includes member Patient resources from ClickHouse roster', async () => {
        const request = await createTestRequest((c) => {
            c.register('k8sClient', (c) => new MockK8sClient({ configManager: c.configManager }));
            return c;
        });

        const externalHeaders = { ...getHeaders(), [USE_EXTERNAL_STORAGE_HEADER]: 'true' };

        const memberIds = ['grp-p1', 'grp-p2', 'grp-p3'];
        for (const id of memberIds) {
            await request
                .post('/4_0_0/Patient/$merge')
                .send({ resourceType: 'Patient', id, meta: { source: 'http://test.com', security: bwellTags } })
                .set(getHeaders())
                .expect(200);
        }

        // A non-member Patient that must NOT be in the export
        await request
            .post('/4_0_0/Patient/$merge')
            .send({ resourceType: 'Patient', id: 'grp-nonmember', meta: { source: 'http://test.com', security: bwellTags } })
            .set(getHeaders())
            .expect(200);

        // Create a hybrid Group (external storage) whose members are those Patients
        const createResp = await request
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                meta: {
                    source: 'http://export-test.com/Group',
                    security: [
                        { system: 'https://www.icanbwell.com/owner', code: 'bwell' },
                        { system: 'https://www.icanbwell.com/access', code: 'bwell' }
                    ]
                },
                type: 'person',
                actual: true,
                member: memberIds.map(id => ({ entity: { reference: `Patient/${id}` } }))
            })
            .set(externalHeaders)
            .expect(201);

        // Confirm the roster lives in ClickHouse (member stripped from Mongo)
        expect(createResp.body.member).toBeUndefined();

        await syncMaterializedViews();

        const result = await runGroupExport(request, createResp.body.id);
        expect(result.body.errors).toHaveLength(0);

        const patients = exportedResources(result, 'Patient');
        const exportedIds = patients.map(p => p.id).sort();
        expect(exportedIds).toEqual(memberIds.slice().sort());
        expect(exportedIds).not.toContain('grp-nonmember');
    }, 60000);

    test('Owned hybrid Group whose roster has zero Patient members exports nothing (no tenant-wide fallback)', async () => {
        const request = await createTestRequest((c) => {
            c.register('k8sClient', (c) => new MockK8sClient({ configManager: c.configManager }));
            return c;
        });

        const externalHeaders = { ...getHeaders(), [USE_EXTERNAL_STORAGE_HEADER]: 'true' };

        // A Patient owned by the SAME caller that is NOT a member of the group.
        // If the fall-through guard regressed, this patient would leak into the output.
        await request
            .post('/4_0_0/Patient/$merge')
            .send({ resourceType: 'Patient', id: 'empty-grp-nonmember', meta: { source: 'http://test.com', security: bwellTags } })
            .set(getHeaders())
            .expect(200);

        // A non-member Practitioner so the roster resolves but the Patient set is empty
        await request
            .post('/4_0_0/Practitioner/$merge')
            .send({ resourceType: 'Practitioner', id: 'empty-grp-practitioner', meta: { source: 'http://test.com', security: bwellTags } })
            .set(getHeaders())
            .expect(200);

        // Hybrid Group owned by the caller (bwell) with only a non-Patient member
        const createResp = await request
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                meta: { source: 'http://export-test.com/Group', security: bwellTags },
                type: 'practitioner',
                actual: true,
                member: [{ entity: { reference: 'Practitioner/empty-grp-practitioner' } }]
            })
            .set(externalHeaders)
            .expect(201);

        expect(createResp.body.member).toBeUndefined();

        await syncMaterializedViews();

        const result = await runGroupExport(request, createResp.body.id);
        expect(result.body.errors).toHaveLength(0);

        // No Patient output, and the owned non-member Patient must not appear anywhere.
        const allOutputResources = result.body.output.flatMap(o => exportedResources(result, o.type));
        const allIds = allOutputResources.map(r => r.id);
        expect(exportedResources(result, 'Patient')).toHaveLength(0);
        expect(allIds).not.toContain('empty-grp-nonmember');
    }, 60000);

    test('Group export with a malformed group id fails the export (invalid id rejected at the datastore boundary)', async () => {
        const request = await createTestRequest((c) => {
            c.register('k8sClient', (c) => new MockK8sClient({ configManager: c.configManager }));
            return c;
        });

        // A Patient the caller owns: must NOT leak even though the id is rejected.
        await request
            .post('/4_0_0/Patient/$merge')
            .send({ resourceType: 'Patient', id: 'bad-id-nonmember', meta: { source: 'http://test.com', security: bwellTags } })
            .set(getHeaders())
            .expect(200);

        // 'bad!id' matches the route's [^/]+ segment but fails the FHIR-id regex.
        const malformedId = 'bad!id';

        let resp = await request
            .get(`/4_0_0/Group/${malformedId}/$export`)
            .set(getHeaders())
            .expect(202);

        const exportStatusId = resp.headers['content-location'].split('/').pop();

        const container = getTestContainer();
        const postRequestProcessor = container.postRequestProcessor;
        const postSaveProcessor = container.postSaveProcessor;
        const requestId = generateUUID();
        const s3Client = new CapturingS3Client({ bucketName: 'test', region: 'test' });

        delete container.services.bulkDataExportRunner;
        container.register('bulkDataExportRunner', (c) => new BulkDataExportRunner({
            databaseQueryFactory: c.databaseQueryFactory,
            databaseExportManager: c.databaseExportManager,
            patientFilterManager: c.patientFilterManager,
            databaseAttachmentManager: c.databaseAttachmentManager,
            r4SearchQueryCreator: c.r4SearchQueryCreator,
            patientQueryCreator: c.patientQueryCreator,
            enrichmentManager: c.enrichmentManager,
            resourceLocatorFactory: c.resourceLocatorFactory,
            r4ArgsParser: c.r4ArgsParser,
            searchManager: c.searchManager,
            postSaveProcessor: c.postSaveProcessor,
            bulkExportEventProducer: c.bulkExportEventProducer,
            storageProviderFactory: c.storageProviderFactory,
            exportStatusId,
            patientReferenceBatchSize: 1000,
            uploadPartSize: 1024 * 1024,
            s3Client,
            requestId
        }));

        await container.bulkDataExportRunner.processAsync();
        await postRequestProcessor.executeAsync({ requestId });
        await postSaveProcessor.flushAsync();

        // Invalid id -> runner throws -> ExportStatus marked entered-in-error (not completed).
        resp = await request
            .get(`/4_0_0/$export/${exportStatusId}`)
            .set(getHeaders())
            .expect(202);
        expect(resp.headers['x-progress']).toEqual('entered-in-error');

        // And no patient data was written (the owned non-member must not leak).
        expect(s3Client.getResourcesForPublicPath('s3://test/exports/bwell/' + exportStatusId + '/Patient.ndjson')).toHaveLength(0);
    }, 60000);

    test('Non-ClickHouse Group export enumerates inline Group.member[] from Mongo', async () => {
        const request = await createTestRequest((c) => {
            c.register('k8sClient', (c) => new MockK8sClient({ configManager: c.configManager }));
            return c;
        });

        const memberIds = ['inline-p1', 'inline-p2'];
        for (const id of memberIds) {
            await request
                .post('/4_0_0/Patient/$merge')
                .send({ resourceType: 'Patient', id, meta: { source: 'http://test.com', security: bwellTags } })
                .set(getHeaders())
                .expect(200);
        }

        await request
            .post('/4_0_0/Patient/$merge')
            .send({ resourceType: 'Patient', id: 'inline-nonmember', meta: { source: 'http://test.com', security: bwellTags } })
            .set(getHeaders())
            .expect(200);

        // Create a normal Group WITHOUT the external-storage header: members stay inline in Mongo
        const createResp = await request
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                meta: {
                    source: 'http://export-test.com/Group',
                    security: [
                        { system: 'https://www.icanbwell.com/owner', code: 'bwell' },
                        { system: 'https://www.icanbwell.com/access', code: 'bwell' }
                    ]
                },
                type: 'person',
                actual: true,
                member: memberIds.map(id => ({ entity: { reference: `Patient/${id}` } }))
            })
            .set(getHeaders())
            .expect(201);

        // Members remain inline for a normal Group
        expect(createResp.body.member).toHaveLength(memberIds.length);

        const result = await runGroupExport(request, createResp.body.id);
        expect(result.body.errors).toHaveLength(0);

        const patients = exportedResources(result, 'Patient');
        const exportedIds = patients.map(p => p.id).sort();
        expect(exportedIds).toEqual(memberIds.slice().sort());
        expect(exportedIds).not.toContain('inline-nonmember');
    }, 60000);

    test('Group export enforces tenant isolation across owner/access tags', async () => {
        const request = await createTestRequest((c) => {
            c.register('k8sClient', (c) => new MockK8sClient({ configManager: c.configManager }));
            return c;
        });

        const tenantAHeaders = { ...getHeaders('user/*.* access/tenantA.*'), [USE_EXTERNAL_STORAGE_HEADER]: 'true' };
        const tenantBHeaders = { ...getHeaders('user/*.* access/tenantB.*'), [USE_EXTERNAL_STORAGE_HEADER]: 'true' };

        await request
            .post('/4_0_0/Patient/$merge')
            .send({
                resourceType: 'Patient',
                id: 'tenantA-patient',
                meta: { source: 'http://a.com', security: [
                    { system: 'https://www.icanbwell.com/owner', code: 'tenantA' },
                    { system: 'https://www.icanbwell.com/access', code: 'tenantA' }
                ] }
            })
            .set(tenantAHeaders)
            .expect(200);

        await request
            .post('/4_0_0/Patient/$merge')
            .send({
                resourceType: 'Patient',
                id: 'tenantB-patient',
                meta: { source: 'http://b.com', security: [
                    { system: 'https://www.icanbwell.com/owner', code: 'tenantB' },
                    { system: 'https://www.icanbwell.com/access', code: 'tenantB' }
                ] }
            })
            .set(tenantBHeaders)
            .expect(200);

        const groupA = await request
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                meta: { source: 'http://a.com/Group', security: [
                    { system: 'https://www.icanbwell.com/owner', code: 'tenantA' },
                    { system: 'https://www.icanbwell.com/access', code: 'tenantA' }
                ] },
                type: 'person',
                actual: true,
                member: [{ entity: { reference: 'Patient/tenantA-patient' } }]
            })
            .set(tenantAHeaders)
            .expect(201);

        const groupB = await request
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                meta: { source: 'http://b.com/Group', security: [
                    { system: 'https://www.icanbwell.com/owner', code: 'tenantB' },
                    { system: 'https://www.icanbwell.com/access', code: 'tenantB' }
                ] },
                type: 'person',
                actual: true,
                member: [{ entity: { reference: 'Patient/tenantB-patient' } }]
            })
            .set(tenantBHeaders)
            .expect(201);

        await syncMaterializedViews();

        // Export tenant A's Group as tenant A: only tenant A member, no tenant B leak
        const resultA = await runGroupExport(request, groupA.body.id, { scope: 'user/*.* access/tenantA.*' });
        expect(resultA.body.errors).toHaveLength(0);
        const exportedIds = exportedResources(resultA, 'Patient').map(p => p.id);
        expect(exportedIds).toContain('tenantA-patient');
        expect(exportedIds).not.toContain('tenantB-patient');

        // Tenant A cannot see tenant B's Group -> empty export, no leak
        const resultCross = await runGroupExport(request, groupB.body.id, { scope: 'user/*.* access/tenantA.*' });
        expect(exportedResources(resultCross, 'Patient')).toHaveLength(0);
    }, 60000);

    test('Group export rejects unscoped non-admin token at kickoff', async () => {
        const request = await createTestRequest((c) => {
            c.register('k8sClient', (c) => new MockK8sClient({ configManager: c.configManager }));
            return c;
        });

        // patient scope with no access scope: kickoff must be forbidden
        await request
            .get('/4_0_0/Group/some-group/$export')
            .set(getHeaders('patient/*.read'))
            .expect(403);
    }, 30000);
});
