// Group/{id}/$export for Mongo-native ("extended") Groups: the roster lives in GroupMember_4_0_0.
// ENABLE_EXTENDED_GROUP is set to '1' globally in jest/setEnvVars.js.
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

const { commonBeforeEach, commonAfterEach, createTestRequest, getHeaders, getTestContainer } = require('../common');
const { BulkDataExportRunner } = require('../../../operations/export/script/bulkDataExportRunner');
const { MockK8sClient } = require('./mocks/k8sClient');
const { MockS3Client } = require('./mocks/s3Client');
const { generateUUID } = require('../../../utils/uid.util');
const { MONGO_GROUP_EXTENDED_FIELD } = require('../../../utils/mongoGroupExtendedTag');
const { GROUP_MEMBER_COLLECTION_NAME } = require('../../../constants');

const GROUP_COLLECTION_NAME = 'Group_4_0_0';

const tagsFor = (tenant) => [
    { system: 'https://www.icanbwell.com/owner', code: tenant },
    { system: 'https://www.icanbwell.com/access', code: tenant }
];
const bwellTags = tagsFor('bwell');

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
 * Kicks off a Group export and runs the runner in-process with a fresh runner instance (the
 * container caches resolved services). Returns { request-independent handles } for polling.
 */
async function kickOffAndRun(request, groupId, { headers, query, patientReferenceBatchSize = 1000 } = {}) {
    let resp = await request
        .get(`/4_0_0/Group/${groupId}/$export${query ? `?${query}` : ''}`)
        .set(headers || getHeaders())
        .expect(202);

    expect(resp.headers['content-location']).toBeDefined();
    const exportStatusId = resp.headers['content-location'].split('/').pop();

    resp = await request
        .get(`/4_0_0/$export/${exportStatusId}`)
        .set(getHeaders())
        .expect(202);
    expect(resp.headers['x-progress']).toEqual('accepted');

    const container = getTestContainer();
    const requestId = generateUUID();
    const s3Client = new CapturingS3Client({ bucketName: 'test', region: 'test' });

    delete container.services.bulkDataExportRunner;
    container.register('bulkDataExportRunner', (c) => new BulkDataExportRunner({
        scopesManager: c.scopesManager,
        databaseQueryFactory: c.databaseQueryFactory,
        databaseExportManager: c.databaseExportManager,
        patientFilterManager: c.patientFilterManager,
        databaseAttachmentManager: c.databaseAttachmentManager,
        base64DataManager: c.base64DataManager,
        r4SearchQueryCreator: c.r4SearchQueryCreator,
        patientQueryCreator: c.patientQueryCreator,
        enrichmentManager: c.enrichmentManager,
        resourceLocatorFactory: c.resourceLocatorFactory,
        r4ArgsParser: c.r4ArgsParser,
        searchManager: c.searchManager,
        postSaveProcessor: c.postSaveProcessor,
        bulkExportEventProducer: c.bulkExportEventProducer,
        storageProviderFactory: c.storageProviderFactory,
        mongoGroupMemberRepository: c.mongoGroupMemberRepository,
        exportStatusId,
        patientReferenceBatchSize,
        uploadPartSize: 1024 * 1024,
        s3Client,
        requestId
    }));

    await container.bulkDataExportRunner.processAsync();
    await container.postRequestProcessor.executeAsync({ requestId });
    await container.postSaveProcessor.flushAsync();

    return { exportStatusId, s3Client };
}

/**
 * Runs a full Group export cycle that is expected to complete; returns { body, s3Client }.
 * `query` is an optional query string (e.g. '_type=Patient&_elements=id') appended to the
 * kickoff URL; it is preserved into ExportStatus.request and parsed by the runner.
 */
async function runGroupExport(request, groupId, options = {}) {
    const { exportStatusId, s3Client } = await kickOffAndRun(request, groupId, options);
    const resp = await request
        .get(`/4_0_0/$export/${exportStatusId}`)
        .set(getHeaders())
        .expect(200);
    return { body: resp.body, s3Client };
}

/**
 * Runs a Group export cycle that is expected to fail: the runner throws, the ExportStatus is
 * marked entered-in-error (never completed), and no Patient data is written.
 */
async function runGroupExportExpectingError(request, groupId, options = {}) {
    const { exportStatusId, s3Client } = await kickOffAndRun(request, groupId, options);
    const resp = await request
        .get(`/4_0_0/$export/${exportStatusId}`)
        .set(getHeaders())
        .expect(202);
    expect(resp.headers['x-progress']).toEqual('entered-in-error');
    return { exportStatusId, s3Client };
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

function memberRow(groupUuid, uuid, reference, inactive = false) {
    return {
        id: uuid,
        _uuid: uuid,
        meta: { versionId: '1', lastUpdated: new Date(), security: bwellTags },
        _sourceAssigningAuthority: 'bwell',
        groupUuid,
        member: { entity: { reference }, inactive }
    };
}

describe('Group $export for extended (Mongo-native) Groups', () => {
    let request;
    let fhirDb;

    beforeEach(async () => {
        process.env.ENABLE_BULK_EXPORT = '1';
        const container = getTestContainer();
        if (container) {
            delete container.services.bulkDataExportRunner;
        }
        await commonBeforeEach();
        request = await createTestRequest((c) => {
            c.register('k8sClient', (c) => new MockK8sClient({ configManager: c.configManager }));
            return c;
        });
        fhirDb = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
    });

    afterEach(async () => {
        process.env.ENABLE_BULK_EXPORT = '0';
        await commonAfterEach();
    });

    async function mergePatients(ids, { tenant = 'bwell', headers = getHeaders() } = {}) {
        for (const id of ids) {
            await request
                .post('/4_0_0/Patient/$merge')
                .send({ resourceType: 'Patient', id, meta: { source: 'http://test.com', security: tagsFor(tenant) } })
                .set(headers)
                .expect(200);
        }
    }

    /**
     * Creates a Group with no inline members, then marks it extended directly in Mongo (the
     * state promotion leaves it in). Returns { groupId, groupUuid }.
     */
    async function createExtendedGroup({ tenant = 'bwell', headers = getHeaders() } = {}) {
        const createResp = await request
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                meta: { source: 'http://export-test.com/Group', security: tagsFor(tenant) },
                type: 'person',
                actual: true
            })
            .set(headers)
            .expect(201);
        const groupId = createResp.body.id;
        const groupCollection = fhirDb.collection(GROUP_COLLECTION_NAME);
        await groupCollection.updateOne({ id: groupId }, { $set: { [MONGO_GROUP_EXTENDED_FIELD]: true } });
        const groupDoc = await groupCollection.findOne({ id: groupId });
        return { groupId, groupUuid: groupDoc._uuid };
    }

    test('pages the member collection and exports every Patient member, inactive included', async () => {
        await mergePatients(['ext-p1', 'ext-p2', 'ext-p3', 'ext-p4', 'ext-p5', 'ext-nonmember']);
        const { groupId, groupUuid } = await createExtendedGroup();
        // Rows seeded out of _uuid order; Practitioner rows interleaved so a page of them sits
        // between Patient pages.
        await fhirDb.collection(GROUP_MEMBER_COLLECTION_NAME).insertMany([
            memberRow(groupUuid, 'r05', 'Patient/ext-p5'),
            memberRow(groupUuid, 'r01', 'Patient/ext-p1'),
            memberRow(groupUuid, 'r02', 'Practitioner/doc-1'),
            memberRow(groupUuid, 'r03', 'Practitioner/doc-2'),
            memberRow(groupUuid, 'r04', 'Patient/ext-p2', true), // inactive -- still exported
            memberRow(groupUuid, 'r06', 'Patient/ext-p3'),
            memberRow(groupUuid, 'r07', 'Patient/ext-p4')
        ]);

        const result = await runGroupExport(request, groupId, { patientReferenceBatchSize: 2 });

        expect(result.body.errors).toHaveLength(0);
        const ids = exportedResources(result, 'Patient').map(p => p.id).sort();
        expect(ids).toEqual(['ext-p1', 'ext-p2', 'ext-p3', 'ext-p4', 'ext-p5']);
        expect(ids).not.toContain('ext-nonmember');
    }, 60000);

    test('member rows of another Group are not included', async () => {
        await mergePatients(['ext-p1', 'ext-nonmember']);
        const { groupId, groupUuid } = await createExtendedGroup();
        await fhirDb.collection(GROUP_MEMBER_COLLECTION_NAME).insertMany([
            memberRow(groupUuid, 'r01', 'Patient/ext-p1'),
            memberRow('some-other-group-uuid', 'r02', 'Patient/ext-nonmember')
        ]);

        const result = await runGroupExport(request, groupId);

        expect(exportedResources(result, 'Patient').map(p => p.id)).toEqual(['ext-p1']);
    }, 60000);

    test('caller without access to the Group gets an empty Patient export (no leak)', async () => {
        const tenantAHeaders = getHeaders('user/*.* access/tenantA.*');
        const tenantBHeaders = getHeaders('user/*.* access/tenantB.*');
        await mergePatients(['tenantA-patient'], { tenant: 'tenantA', headers: tenantAHeaders });
        const { groupId, groupUuid } = await createExtendedGroup({ tenant: 'tenantA', headers: tenantAHeaders });
        await fhirDb.collection(GROUP_MEMBER_COLLECTION_NAME).insertMany([
            memberRow(groupUuid, 'r01', 'Patient/tenantA-patient')
        ]);

        // Owner tenant sees its member
        const resultA = await runGroupExport(request, groupId, { headers: tenantAHeaders });
        expect(exportedResources(resultA, 'Patient').map(p => p.id)).toEqual(['tenantA-patient']);

        // Another tenant cannot see the Group -> empty export, no leak
        const resultB = await runGroupExport(request, groupId, { headers: tenantBHeaders });
        expect(exportedResources(resultB, 'Patient')).toEqual([]);
    }, 60000);

    test('ENABLE_EXTENDED_GROUP off: export fails loudly (entered-in-error), no Patient data written', async () => {
        await mergePatients(['ext-p1']);
        const { groupId, groupUuid } = await createExtendedGroup();
        await fhirDb.collection(GROUP_MEMBER_COLLECTION_NAME).insertMany([
            memberRow(groupUuid, 'r01', 'Patient/ext-p1')
        ]);

        const saved = process.env.ENABLE_EXTENDED_GROUP;
        delete process.env.ENABLE_EXTENDED_GROUP;
        try {
            const { exportStatusId, s3Client } = await runGroupExportExpectingError(request, groupId);
            expect(
                s3Client.getResourcesForPublicPath(`s3://test/exports/bwell/${exportStatusId}/Patient.ndjson`)
            ).toHaveLength(0);
        } finally {
            process.env.ENABLE_EXTENDED_GROUP = saved;
        }
    }, 60000);

    test('IG patient-list pattern: _type=Patient&_elements=id returns exactly the members', async () => {
        await mergePatients(['ext-p1', 'ext-p2', 'ext-nonmember']);
        const { groupId, groupUuid } = await createExtendedGroup();
        await fhirDb.collection(GROUP_MEMBER_COLLECTION_NAME).insertMany([
            memberRow(groupUuid, 'r01', 'Patient/ext-p1'),
            memberRow(groupUuid, 'r02', 'Patient/ext-p2', true)
        ]);

        const result = await runGroupExport(request, groupId, { query: '_type=Patient&_elements=id' });

        expect(result.body.output.map(o => o.type)).toEqual(['Patient']);
        const ids = exportedResources(result, 'Patient').map(p => p.id).sort();
        expect(ids).toEqual(['ext-p1', 'ext-p2']);
    }, 60000);

    test('embedded Group export is unchanged', async () => {
        await mergePatients(['ext-p1', 'ext-nonmember']);
        const createResp = await request
            .post('/4_0_0/Group')
            .send({
                resourceType: 'Group',
                meta: { source: 'http://export-test.com/Group', security: bwellTags },
                type: 'person',
                actual: true,
                member: [
                    { entity: { reference: 'Patient/ext-p1' } },
                    { entity: { reference: 'Practitioner/doc-1' } }
                ]
            })
            .set(getHeaders())
            .expect(201);

        const result = await runGroupExport(request, createResp.body.id);

        expect(exportedResources(result, 'Patient').map(p => p.id)).toEqual(['ext-p1']);
    }, 60000);
});
