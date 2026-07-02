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
 * `query` is an optional query string (e.g. '_type=Patient&_elements=id') appended
 * to the kickoff URL; it is preserved into ExportStatus.request and parsed by the runner.
 */
async function runGroupExport(request, groupId, { scope, query } = {}) {
    const headers = scope ? getHeaders(scope) : getHeaders();

    let resp = await request
        .get(`/4_0_0/Group/${groupId}/$export${query ? `?${query}` : ''}`)
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

    test('Group $export _type=Patient&_elements=id returns id-only Patient rows without PHI', async () => {
        const request = await createTestRequest((c) => {
            c.register('k8sClient', (c) => new MockK8sClient({ configManager: c.configManager }));
            return c;
        });

        const externalHeaders = { ...getHeaders(), [USE_EXTERNAL_STORAGE_HEADER]: 'true' };

        // Members carry PHI (name/birthDate/telecom) that must NOT appear in the id-only roster.
        const memberIds = ['elem-p1', 'elem-p2'];
        for (const id of memberIds) {
            await request
                .post('/4_0_0/Patient/$merge')
                .send({
                    resourceType: 'Patient',
                    id,
                    meta: { source: 'http://test.com', security: bwellTags },
                    name: [{ family: 'Doe', given: ['Jane'] }],
                    birthDate: '1980-01-01',
                    telecom: [{ system: 'phone', value: '555-0100' }]
                })
                .set(getHeaders())
                .expect(200);
        }

        const createResp = await request
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                meta: { source: 'http://export-test.com/Group', security: bwellTags },
                type: 'person',
                actual: true,
                member: memberIds.map(id => ({ entity: { reference: `Patient/${id}` } }))
            })
            .set(externalHeaders)
            .expect(201);

        expect(createResp.body.member).toBeUndefined();

        await syncMaterializedViews();

        const result = await runGroupExport(request, createResp.body.id, { query: '_type=Patient&_elements=id' });
        expect(result.body.errors).toHaveLength(0);

        const patients = exportedResources(result, 'Patient');
        expect(patients.map(p => p.id).sort()).toEqual(memberIds.slice().sort());

        // Every row is a valid Patient carrying only mandatory fields; no requested-out PHI.
        for (const patient of patients) {
            expect(patient.resourceType).toEqual('Patient');
            expect(patient.id).toBeDefined();
            expect(patient.name).toBeUndefined();
            expect(patient.birthDate).toBeUndefined();
            expect(patient.telecom).toBeUndefined();
            // Mongo-internal fields must never leak into the NDJSON.
            expect(patient._uuid).toBeUndefined();
            expect(patient._sourceId).toBeUndefined();
        }
    }, 60000);

    test('Group $export without _elements still returns full Patient resources (regression)', async () => {
        const request = await createTestRequest((c) => {
            c.register('k8sClient', (c) => new MockK8sClient({ configManager: c.configManager }));
            return c;
        });

        const externalHeaders = { ...getHeaders(), [USE_EXTERNAL_STORAGE_HEADER]: 'true' };

        await request
            .post('/4_0_0/Patient/$merge')
            .send({
                resourceType: 'Patient',
                id: 'full-p1',
                meta: { source: 'http://test.com', security: bwellTags },
                name: [{ family: 'Roe', given: ['John'] }],
                birthDate: '1975-05-05'
            })
            .set(getHeaders())
            .expect(200);

        const createResp = await request
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                meta: { source: 'http://export-test.com/Group', security: bwellTags },
                type: 'person',
                actual: true,
                member: [{ entity: { reference: 'Patient/full-p1' } }]
            })
            .set(externalHeaders)
            .expect(201);

        expect(createResp.body.member).toBeUndefined();

        await syncMaterializedViews();

        const result = await runGroupExport(request, createResp.body.id);
        expect(result.body.errors).toHaveLength(0);

        const patients = exportedResources(result, 'Patient');
        expect(patients).toHaveLength(1);
        // Full export keeps hydrated PHI fields.
        expect(patients[0].name).toEqual([{ family: 'Roe', given: ['John'] }]);
        expect(patients[0].birthDate).toEqual('1975-05-05');
    }, 60000);

    test('System $export _type=Patient&_elements=id projects beyond Group', async () => {
        const request = await createTestRequest((c) => {
            c.register('k8sClient', (c) => new MockK8sClient({ configManager: c.configManager }));
            return c;
        });

        await request
            .post('/4_0_0/Patient/$merge')
            .send({
                resourceType: 'Patient',
                id: 'sys-p1',
                meta: { source: 'http://test.com', security: bwellTags },
                name: [{ family: 'System', given: ['Sam'] }],
                birthDate: '1990-09-09'
            })
            .set(getHeaders())
            .expect(200);

        // Kick off a system-level export scoped to Patient with an id-only projection.
        // System/Patient $export are POST routes (Group is GET); query params still land in ExportStatus.request.
        let resp = await request
            .post('/4_0_0/$export?_type=Patient&_elements=id')
            .set(getHeaders())
            .expect(202);
        const exportStatusId = resp.headers['content-location'].split('/').pop();

        const container = getTestContainer();
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
        await container.postRequestProcessor.executeAsync({ requestId });
        await container.postSaveProcessor.flushAsync();

        resp = await request
            .get(`/4_0_0/$export/${exportStatusId}`)
            .set(getHeaders())
            .expect(200);

        const entry = resp.body.output.find(o => o.type === 'Patient');
        expect(entry).toBeDefined();
        const patients = s3Client.getResourcesForPublicPath(entry.url);
        const sysPatient = patients.find(p => p.id === 'sys-p1');
        expect(sysPatient).toBeDefined();
        expect(sysPatient.resourceType).toEqual('Patient');
        expect(sysPatient.name).toBeUndefined();
        expect(sysPatient.birthDate).toBeUndefined();
    }, 60000);

    test('Group $export _type=Patient&_elements=id,gender projects exactly requested + mandatory', async () => {
        const request = await createTestRequest((c) => {
            c.register('k8sClient', (c) => new MockK8sClient({ configManager: c.configManager }));
            return c;
        });

        const externalHeaders = { ...getHeaders(), [USE_EXTERNAL_STORAGE_HEADER]: 'true' };

        // Members carry gender (requested) plus name/birthDate/telecom (PHI, not requested).
        const memberIds = ['multi-p1', 'multi-p2'];
        for (const id of memberIds) {
            await request
                .post('/4_0_0/Patient/$merge')
                .send({
                    resourceType: 'Patient',
                    id,
                    meta: { source: 'http://test.com', security: bwellTags },
                    gender: 'female',
                    name: [{ family: 'Doe', given: ['Jane'] }],
                    birthDate: '1980-01-01',
                    telecom: [{ system: 'phone', value: '555-0100' }]
                })
                .set(getHeaders())
                .expect(200);
        }

        const createResp = await request
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                meta: { source: 'http://export-test.com/Group', security: bwellTags },
                type: 'person',
                actual: true,
                member: memberIds.map(id => ({ entity: { reference: `Patient/${id}` } }))
            })
            .set(externalHeaders)
            .expect(201);

        expect(createResp.body.member).toBeUndefined();

        await syncMaterializedViews();

        const result = await runGroupExport(request, createResp.body.id, { query: '_type=Patient&_elements=id,gender' });
        expect(result.body.errors).toHaveLength(0);

        const patients = exportedResources(result, 'Patient');
        expect(patients.map(p => p.id).sort()).toEqual(memberIds.slice().sort());

        for (const patient of patients) {
            expect(patient.resourceType).toEqual('Patient');
            expect(patient.id).toBeDefined();
            expect(patient.gender).toEqual('female');
            // Requested-out PHI must be absent.
            expect(patient.name).toBeUndefined();
            expect(patient.birthDate).toBeUndefined();
            expect(patient.telecom).toBeUndefined();
            // Mongo-internal fields must never leak.
            expect(patient._uuid).toBeUndefined();
            expect(patient._sourceId).toBeUndefined();
        }
    }, 60000);

    test('Group $export with an invalid _elements fails the export and emits no Patient data', async () => {
        const request = await createTestRequest((c) => {
            c.register('k8sClient', (c) => new MockK8sClient({ configManager: c.configManager }));
            return c;
        });

        const externalHeaders = { ...getHeaders(), [USE_EXTERNAL_STORAGE_HEADER]: 'true' };

        await request
            .post('/4_0_0/Patient/$merge')
            .send({
                resourceType: 'Patient',
                id: 'invalid-elem-p1',
                meta: { source: 'http://test.com', security: bwellTags },
                name: [{ family: 'Doe', given: ['Jane'] }]
            })
            .set(getHeaders())
            .expect(200);

        const createResp = await request
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                meta: { source: 'http://export-test.com/Group', security: bwellTags },
                type: 'person',
                actual: true,
                member: [{ entity: { reference: 'Patient/invalid-elem-p1' } }]
            })
            .set(externalHeaders)
            .expect(201);

        expect(createResp.body.member).toBeUndefined();

        await syncMaterializedViews();

        // Kick off with an unknown element: handleElementsQuery throws BadRequestError,
        // which propagates and marks the ExportStatus entered-in-error (never completed).
        let resp = await request
            .get('/4_0_0/Group/' + createResp.body.id + '/$export?_type=Patient&_elements=notARealField')
            .set(getHeaders())
            .expect(202);
        const exportStatusId = resp.headers['content-location'].split('/').pop();

        const container = getTestContainer();
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
        await container.postRequestProcessor.executeAsync({ requestId });
        await container.postSaveProcessor.flushAsync();

        // Export did not complete: status poll stays 202 with entered-in-error progress.
        resp = await request
            .get(`/4_0_0/$export/${exportStatusId}`)
            .set(getHeaders())
            .expect(202);
        expect(resp.headers['x-progress']).toEqual('entered-in-error');

        // No populated Patient NDJSON was written (the invalid projection aborted the fetch).
        const patientParts = Object.entries(s3Client.partsByPath)
            .filter(([path]) => path.includes('Patient'))
            .flatMap(([, parts]) => parts)
            .filter(data => data && data.trim().length > 0);
        expect(patientParts).toHaveLength(0);
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
