const {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    jest,
    test
} = require('@jest/globals');

const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getHeaders,
    getHeadersNdJson,
    getGraphQLHeaders,
    getTestContainer,
    mockHttpContext
} = require('../../common');
const { MockS3Client } = require('../../export/mocks/s3Client');
const { CLOUD_STORAGE_CLIENTS } = require('../../../constants');

const expectedBinaryHistoryListResponse = require('./fixtures/expected/expectedBinaryHistoryList.json');
const expectedBinaryHistoryVersionReadResponse = require('./fixtures/expected/expectedBinaryHistoryVersionRead.json');
const expectedBinaryTypeHistoryResponse = require('./fixtures/expected/expectedBinaryTypeHistory.json');
const expectedBinaryThresholdFlipFlopHistoryResponse = require('./fixtures/expected/expectedBinaryThresholdFlipFlopHistory.json');

// 80 KB string — exceeds the 64 KB default threshold and triggers S3 offload.
const LARGE_DATA = 'A'.repeat(80 * 1024);
// 1 KB string — stays inline.
const SMALL_DATA = 'B'.repeat(1024);
// 70 KB replacement payload — also above threshold, used to test PUT-overwriting an externalized Binary.
const ALT_LARGE_DATA = 'C'.repeat(70 * 1024);

/**
 * Build a Binary resource fixture with deterministic id + access tag so we can identify it in Mongo.
 */
const buildBinary = ({ id, data }) => ({
    resourceType: 'Binary',
    id,
    meta: {
        source: 'https://test.example.com/source',
        security: [
            { system: 'https://www.icanbwell.com/owner', code: 'test' },
            { system: 'https://www.icanbwell.com/access', code: 'test' },
            { system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'test' }
        ]
    },
    contentType: 'application/pdf',
    data
});

const LIVE_BUCKET = 'test-base64-live-bucket';
const HISTORY_BUCKET = 'test-base64-history-bucket';

describe('Binary base64 S3 offload — write paths', () => {
    let savedEnv;

    beforeAll(() => {
        savedEnv = {
            BASE64_FIELD_CLOUD_STORAGE_ENABLED: process.env.BASE64_FIELD_CLOUD_STORAGE_ENABLED,
            BASE64_FIELD_CLOUD_STORAGE_CLIENT: process.env.BASE64_FIELD_CLOUD_STORAGE_CLIENT,
            RESOURCE_BUCKET_NAME: process.env.RESOURCE_BUCKET_NAME,
            HISTORY_RESOURCE_CLOUD_STORAGE_CLIENT: process.env.HISTORY_RESOURCE_CLOUD_STORAGE_CLIENT,
            HISTORY_RESOURCE_BUCKET_NAME: process.env.HISTORY_RESOURCE_BUCKET_NAME,
            BASE64_FIELD_DATA_THRESHOLD_KB: process.env.BASE64_FIELD_DATA_THRESHOLD_KB
        };
        process.env.BASE64_FIELD_CLOUD_STORAGE_ENABLED = '1';
        process.env.BASE64_FIELD_CLOUD_STORAGE_CLIENT = CLOUD_STORAGE_CLIENTS.S3_CLIENT;
        process.env.RESOURCE_BUCKET_NAME = LIVE_BUCKET;
        process.env.HISTORY_RESOURCE_CLOUD_STORAGE_CLIENT = CLOUD_STORAGE_CLIENTS.S3_CLIENT;
        process.env.HISTORY_RESOURCE_BUCKET_NAME = HISTORY_BUCKET;
        process.env.BASE64_FIELD_DATA_THRESHOLD_KB = '64';
    });

    afterAll(() => {
        for (const [key, value] of Object.entries(savedEnv)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    });

    const registerMockClients = (c) => {
        c.register('base64FieldCloudStorageClient', (cc) => {
            if (cc.configManager.base64FieldCloudStorageClient === CLOUD_STORAGE_CLIENTS.S3_CLIENT) {
                return new MockS3Client({
                    bucketName: cc.configManager.resourceBucketName,
                    region: cc.configManager.awsRegion
                });
            }
            return null;
        });
        c.register('historyResourceCloudStorageClient', (cc) => {
            if (cc.configManager.historyResourceCloudStorageClient === CLOUD_STORAGE_CLIENTS.S3_CLIENT) {
                return new MockS3Client({
                    bucketName: cc.configManager.historyResourceBucketName,
                    region: cc.configManager.awsRegion
                });
            }
            return null;
        });
        return c;
    };

    let requestId;
    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
        // The container (and therefore the MockS3Client instances) is cached across tests.
        // Reset the in-memory uploadedData maps so each test starts with empty buckets.
        const container = getTestContainer();
        if (container) {
            const liveClient = container.base64FieldCloudStorageClient;
            const historyClient = container.historyResourceCloudStorageClient;
            if (liveClient) liveClient.uploadedData = {};
            if (historyClient) historyClient.uploadedData = {};
        }
    });

    /**
     * Drain the post-request processor before the next HTTP request runs in the same test.
     * Because `mockHttpContext` reuses a fixed requestId, two consecutive writes (PUT + PATCH,
     * or PUT + PUT) would otherwise share one post-request queue — and the still-running
     * loop from the first request swallows the second request's history task before its
     * scheduling closure adds the new entry. Awaiting the processor to fully drain between
     * writes restores the per-request isolation the live server gets naturally.
     */
    const drainPostRequest = async (container) => {
        await container.postRequestProcessor.waitTillDoneAsync({ requestId, timeoutInSeconds: 20 });
    };

    afterEach(async () => {
        await commonAfterEach();
        jest.clearAllMocks();
    });

    const readBinaryFromMongo = async (container, idOrUuid) => {
        const fhirDb = await container.mongoDatabaseManager.getClientDbAsync();
        const docs = await fhirDb
            .collection('Binary_4_0_0')
            .find({ $or: [{ id: idOrUuid }, { _uuid: idOrUuid }] })
            .toArray();
        return docs[0];
    };

    const readBinaryHistoryFromMongo = async (container) => {
        const historyDb = await container.mongoDatabaseManager.getResourceHistoryDbAsync();
        return historyDb.collection('Binary_4_0_0_History').find({}).toArray();
    };

    test('Create with data above threshold offloads to live bucket', async () => {
        const request = await createTestRequest(registerMockClients);
        const container = getTestContainer();
        const liveClient = container.base64FieldCloudStorageClient;
        const id = 'binary-large-create';

        // Use PUT so the server preserves our id (POST always assigns a new UUID).
        // DB is dropped between tests, so this is a create → 201.
        const resp = await request
            .put(`/4_0_0/Binary/${id}`)
            .send(buildBinary({ id, data: LARGE_DATA }))
            .set(getHeaders())
            .expect(201);

        // Response should still carry the inline data (backward compat).
        expect(resp.body.data).toBe(LARGE_DATA);
        expect(resp.body._blobMeta).toBeUndefined();

        // Mongo doc should NOT have data inline and SHOULD have _blobMeta sidecar.
        const mongoDoc = await readBinaryFromMongo(container, id);
        expect(mongoDoc).toBeDefined();
        expect(mongoDoc.data).toBeUndefined();
        expect(mongoDoc._blobMeta).toBeDefined();
        expect(mongoDoc._blobMeta.rawReference).toBe(mongoDoc._uuid);
        expect(mongoDoc._blobMeta.rawSize).toBe(80);

        // Live S3 should have the payload at the deterministic key.
        const liveKey = `Binary_4_0_0/${mongoDoc._uuid}`;
        expect(liveClient.uploadedData[liveKey]).toBe(LARGE_DATA);

        // Cold read: a follow-up GET request hits a fresh request scope (stash cleared by
        // drainPostRequest), so the response can only have `data` if S3 RETRIEVE actually ran.
        await drainPostRequest(container);
        const downloadSpy = jest.spyOn(liveClient, 'downloadAsync');
        const getResp = await request
            .get(`/4_0_0/Binary/${id}`)
            .set(getHeaders())
            .expect(200);
        expect(getResp.body.data).toBe(LARGE_DATA);
        expect(getResp.body._blobMeta).toBeUndefined();
        expect(downloadSpy).toHaveBeenCalledTimes(1);
        expect(downloadSpy).toHaveBeenCalledWith(`Binary_4_0_0/${mongoDoc._uuid}`);
        downloadSpy.mockRestore();
    });

    test('Create with data below threshold stays inline (no S3 traffic)', async () => {
        const request = await createTestRequest(registerMockClients);
        const container = getTestContainer();
        const liveClient = container.base64FieldCloudStorageClient;
        const id = 'binary-small-create';

        const resp = await request
            .put(`/4_0_0/Binary/${id}`)
            .send(buildBinary({ id, data: SMALL_DATA }))
            .set(getHeaders())
            .expect(201);

        expect(resp.body.data).toBe(SMALL_DATA);

        const mongoDoc = await readBinaryFromMongo(container, id);
        expect(mongoDoc).toBeDefined();
        expect(mongoDoc.data).toBe(SMALL_DATA);
        expect(mongoDoc._blobMeta).toBeUndefined();
        // No object should have landed in the live bucket.
        expect(Object.keys(liveClient.uploadedData)).toHaveLength(0);

        await drainPostRequest(container);
        const downloadSpy = jest.spyOn(liveClient, 'downloadAsync');
        const getResp = await request
            .get(`/4_0_0/Binary/${id}`)
            .set(getHeaders())
            .expect(200);
        expect(getResp.body.data).toBe(SMALL_DATA);
        expect(downloadSpy).not.toHaveBeenCalled();
        downloadSpy.mockRestore();
    });

    test('PUT update overwrites live key + appends versioned history key', async () => {
        const request = await createTestRequest(registerMockClients);
        const container = getTestContainer();
        const liveClient = container.base64FieldCloudStorageClient;
        const historyClient = container.historyResourceCloudStorageClient;
        const id = 'binary-update-target';

        // Seed via PUT (preserves id) with an above-threshold payload.
        await request
            .put(`/4_0_0/Binary/${id}`)
            .send(buildBinary({ id, data: LARGE_DATA }))
            .set(getHeaders())
            .expect(201);
        await drainPostRequest(container);

        const mongoDocAfterCreate = await readBinaryFromMongo(container, id);
        expect(mongoDocAfterCreate).toBeDefined();
        const liveKey = `Binary_4_0_0/${mongoDocAfterCreate._uuid}`;
        expect(liveClient.uploadedData[liveKey]).toBe(LARGE_DATA);

        // Now PUT with a different above-threshold payload.
        await request
            .put(`/4_0_0/Binary/${id}`)
            .send(buildBinary({ id, data: ALT_LARGE_DATA }))
            .set(getHeaders())
            .expect(200);
        await drainPostRequest(container);

        // Live key now holds the new payload (deterministic overwrite).
        expect(liveClient.uploadedData[liveKey]).toBe(ALT_LARGE_DATA);

        // History bucket should have at least one entry keyed by `Binary_4_0_0/{uuid}/{epoch}`.
        const historyKeys = Object.keys(historyClient.uploadedData);
        expect(historyKeys.length).toBeGreaterThan(0);
        const versionedKeys = historyKeys.filter(k => k.startsWith(`Binary_4_0_0/${mongoDocAfterCreate._uuid}/`));
        expect(versionedKeys.length).toBeGreaterThan(0);
        // Suffix after the uuid should be a numeric epoch — no slashes for the root-path case.
        for (const key of versionedKeys) {
            const suffix = key.replace(`Binary_4_0_0/${mongoDocAfterCreate._uuid}/`, '');
            expect(suffix).toMatch(/^\d{10,}$/);
        }

        // History Mongo snapshot should have `_blobMeta` pointing at the versioned reference.
        const historyDocs = await readBinaryHistoryFromMongo(container);
        const matchedSnapshots = historyDocs.filter(d => d.resource && d.resource._uuid === mongoDocAfterCreate._uuid);
        expect(matchedSnapshots.length).toBeGreaterThan(0);
        for (const entry of matchedSnapshots) {
            if (entry.resource._blobMeta) {
                expect(entry.resource._blobMeta.rawReference).toMatch(
                    new RegExp(`^${mongoDocAfterCreate._uuid}/\\d{10,}$`)
                );
                expect(entry.resource.data).toBeUndefined();
            }
        }

        // Cold read after overwrite must return the new payload, not the prior version.
        const downloadSpy = jest.spyOn(liveClient, 'downloadAsync');
        const getResp = await request
            .get(`/4_0_0/Binary/${id}`)
            .set(getHeaders())
            .expect(200);
        expect(getResp.body.data).toBe(ALT_LARGE_DATA);
        expect(downloadSpy).toHaveBeenCalledTimes(1);
        downloadSpy.mockRestore();
    });

    test('PATCH /data: diagnostics store <data_value> placeholder in Mongo but rehydrate the real value on read', async () => {
        const request = await createTestRequest(registerMockClients);
        const container = getTestContainer();
        const liveClient = container.base64FieldCloudStorageClient;
        const id = 'binary-patch-target';

        await request
            .put(`/4_0_0/Binary/${id}`)
            .send(buildBinary({ id, data: LARGE_DATA }))
            .set(getHeaders())
            .expect(201);
        await drainPostRequest(container);

        const mongoDocAfterCreate = await readBinaryFromMongo(container, id);
        expect(mongoDocAfterCreate).toBeDefined();
        const liveKey = `Binary_4_0_0/${mongoDocAfterCreate._uuid}`;

        // Patch the data field with a new above-threshold payload.
        await request
            .patch(`/4_0_0/Binary/${id}`)
            .send([{ op: 'replace', path: '/data', value: ALT_LARGE_DATA }])
            .set({ ...getHeaders(), 'Content-Type': 'application/json-patch+json' })
            .expect(200);
        await drainPostRequest(container);

        // Live key replaced with new content.
        expect(liveClient.uploadedData[liveKey]).toBe(ALT_LARGE_DATA);

        // Write-side: Mongo history doc for v2 must carry the `<data_value>` placeholder —
        // proves _sanitizeHistoryPatches still fires so we don't bloat the history collection
        // with the full base64 payload.
        const historyDocs = await readBinaryHistoryFromMongo(container);
        const matchedSnapshots = historyDocs.filter(d => d.resource && d.resource._uuid === mongoDocAfterCreate._uuid);
        const v2Snapshot = matchedSnapshots.find(d => d.resource.meta && d.resource.meta.versionId === '2');
        expect(v2Snapshot).toBeDefined();
        const v2DiagnosticInMongo = JSON.parse(v2Snapshot.response.outcome.issue[0].diagnostics);
        expect(v2DiagnosticInMongo.op).toBe('replace');
        expect(v2DiagnosticInMongo.path).toBe('/data');
        expect(v2DiagnosticInMongo.value).toBe('<data_value>');

        // Read-side: GET /_history must rehydrate the placeholder with the real ALT_LARGE_DATA
        // payload pulled from S3 — clients see the same diagnostic shape regardless of whether
        // the version was inline or externalized.
        const historyListResp = await request
            .get(`/4_0_0/Binary/${id}/_history`)
            .set(getHeaders())
            .expect(200);

        const responseEntries = historyListResp.body.entry || [];
        const v2Entry = responseEntries.find(e => e.resource && e.resource.meta && e.resource.meta.versionId === '2');
        expect(v2Entry).toBeDefined();
        const v2DiagnosticOnRead = JSON.parse(v2Entry.response.outcome.issue[0].diagnostics);
        expect(v2DiagnosticOnRead.op).toBe('replace');
        expect(v2DiagnosticOnRead.path).toBe('/data');
        expect(v2DiagnosticOnRead.value).toBe(ALT_LARGE_DATA);
    });

    test('$merge of a mixed Bundle only externalizes the large entry', async () => {
        const request = await createTestRequest(registerMockClients);
        const container = getTestContainer();
        const liveClient = container.base64FieldCloudStorageClient;

        const largeId = 'binary-merge-large';
        const smallId = 'binary-merge-small';
        const bundle = {
            resourceType: 'Bundle',
            type: 'collection',
            entry: [
                { resource: buildBinary({ id: largeId, data: LARGE_DATA }) },
                { resource: buildBinary({ id: smallId, data: SMALL_DATA }) }
            ]
        };

        await request
            .post('/4_0_0/Binary/$merge')
            .send(bundle)
            .set(getHeaders())
            .expect(200);
        await drainPostRequest(container);

        const largeDoc = await readBinaryFromMongo(container, largeId);
        const smallDoc = await readBinaryFromMongo(container, smallId);

        // Large → externalized.
        expect(largeDoc.data).toBeUndefined();
        expect(largeDoc._blobMeta).toBeDefined();
        expect(liveClient.uploadedData[`Binary_4_0_0/${largeDoc._uuid}`]).toBe(LARGE_DATA);

        // Small → inline.
        expect(smallDoc.data).toBe(SMALL_DATA);
        expect(smallDoc._blobMeta).toBeUndefined();
        expect(liveClient.uploadedData[`Binary_4_0_0/${smallDoc._uuid}`]).toBeUndefined();

        // Cold read via search bundle: both entries come back with `data` populated,
        // and S3 was hit exactly once (for the large entry only). STREAM_RESPONSE is
        // forced off so the GET routes through SearchBundleOperation (the path under
        // test) rather than the streaming reader, which has its own RETRIEVE wiring.
        const originalStreamResponse = process.env.STREAM_RESPONSE;
        process.env.STREAM_RESPONSE = '0';
        try {
            const downloadSpy = jest.spyOn(liveClient, 'downloadAsync');
            const searchResp = await request
                .get(`/4_0_0/Binary?_bundle=1&_count=10&id=${largeId},${smallId}`)
                .set(getHeaders())
                .expect(200);
            expect(searchResp.body.resourceType).toBe('Bundle');
            const entries = searchResp.body.entry || [];
            const largeEntry = entries.find(e => e.resource && e.resource.id === largeId);
            const smallEntry = entries.find(e => e.resource && e.resource.id === smallId);
            expect(largeEntry).toBeDefined();
            expect(smallEntry).toBeDefined();
            expect(largeEntry.resource.data).toBe(LARGE_DATA);
            expect(largeEntry.resource._blobMeta).toBeUndefined();
            expect(smallEntry.resource.data).toBe(SMALL_DATA);
            expect(smallEntry.resource._blobMeta).toBeUndefined();
            expect(downloadSpy).toHaveBeenCalledTimes(1);
            expect(downloadSpy).toHaveBeenCalledWith(`Binary_4_0_0/${largeDoc._uuid}`);
            downloadSpy.mockRestore();
        } finally {
            if (originalStreamResponse === undefined) {
                delete process.env.STREAM_RESPONSE;
            } else {
                process.env.STREAM_RESPONSE = originalStreamResponse;
            }
        }
    });

    test('Streaming search hydrates Binary.data from S3 via MongoReadableStream', async () => {
        const request = await createTestRequest(registerMockClients);
        const container = getTestContainer();
        const liveClient = container.base64FieldCloudStorageClient;

        const largeId = 'binary-stream-large';
        const smallId = 'binary-stream-small';

        await request
            .put(`/4_0_0/Binary/${largeId}`)
            .send(buildBinary({ id: largeId, data: LARGE_DATA }))
            .set(getHeaders())
            .expect(201);
        await drainPostRequest(container);

        await request
            .put(`/4_0_0/Binary/${smallId}`)
            .send(buildBinary({ id: smallId, data: SMALL_DATA }))
            .set(getHeaders())
            .expect(201);
        await drainPostRequest(container);

        const largeDoc = await readBinaryFromMongo(container, largeId);
        const smallDoc = await readBinaryFromMongo(container, smallId);

        expect(largeDoc.data).toBeUndefined();
        expect(largeDoc._blobMeta).toBeDefined();
        expect(liveClient.uploadedData[`Binary_4_0_0/${largeDoc._uuid}`]).toBe(LARGE_DATA);
        expect(smallDoc.data).toBe(SMALL_DATA);

        // Cold read via the default streaming search path (STREAM_RESPONSE=1 in jest env),
        // requesting NDJSON so each Binary serializes as its own newline-delimited line.
        const downloadSpy = jest.spyOn(liveClient, 'downloadAsync');
        const searchResp = await request
            .get(`/4_0_0/Binary?_count=10&id=${largeId},${smallId}`)
            .set(getHeadersNdJson())
            .expect(200);

        expect(searchResp.headers['content-type']).toBe('application/fhir+ndjson');

        const resources = searchResp.text
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .map(line => JSON.parse(line));

        const largeEntry = resources.find(r => r.resourceType === 'Binary' && r.id === largeId);
        const smallEntry = resources.find(r => r.resourceType === 'Binary' && r.id === smallId);
        expect(largeEntry).toBeDefined();
        expect(smallEntry).toBeDefined();
        expect(largeEntry.data).toBe(LARGE_DATA);
        expect(largeEntry._blobMeta).toBeUndefined();
        expect(smallEntry.data).toBe(SMALL_DATA);
        expect(smallEntry._blobMeta).toBeUndefined();
        expect(downloadSpy).toHaveBeenCalledTimes(1);
        expect(downloadSpy).toHaveBeenCalledWith(`Binary_4_0_0/${largeDoc._uuid}`);
        downloadSpy.mockRestore();
    });

    test('PUT without /data field deletes the orphaned live S3 object and clears _blobMeta', async () => {
        const request = await createTestRequest(registerMockClients);
        const container = getTestContainer();
        const liveClient = container.base64FieldCloudStorageClient;
        const id = 'binary-put-remove-target';

        // Seed an externalized Binary.
        await request
            .put(`/4_0_0/Binary/${id}`)
            .send(buildBinary({ id, data: LARGE_DATA }))
            .set(getHeaders())
            .expect(201);
        await drainPostRequest(container);

        const mongoDocAfterCreate = await readBinaryFromMongo(container, id);
        expect(mongoDocAfterCreate).toBeDefined();
        const liveKey = `Binary_4_0_0/${mongoDocAfterCreate._uuid}`;
        expect(liveClient.uploadedData[liveKey]).toBe(LARGE_DATA);

        // PUT a replacement that simply omits `data` — client intent is "no data".
        const incomingWithoutData = buildBinary({ id, data: 'placeholder' });
        delete incomingWithoutData.data;
        await request
            .put(`/4_0_0/Binary/${id}`)
            .send(incomingWithoutData)
            .set(getHeaders())
            .expect(200);
        await drainPostRequest(container);

        // Live S3 object should be gone.
        expect(liveClient.uploadedData[liveKey]).toBeUndefined();

        // Mongo doc should have no data and no _blobMeta.
        const mongoDocAfterPut = await readBinaryFromMongo(container, id);
        expect(mongoDocAfterPut).toBeDefined();
        expect(mongoDocAfterPut.data).toBeUndefined();
        expect(mongoDocAfterPut._blobMeta).toBeUndefined();
    });

    test('PATCH removing /data deletes the orphaned live S3 object', async () => {
        const request = await createTestRequest(registerMockClients);
        const container = getTestContainer();
        const liveClient = container.base64FieldCloudStorageClient;
        const id = 'binary-patch-remove-target';

        // Seed an externalized Binary.
        await request
            .put(`/4_0_0/Binary/${id}`)
            .send(buildBinary({ id, data: LARGE_DATA }))
            .set(getHeaders())
            .expect(201);
        await drainPostRequest(container);

        const mongoDocAfterCreate = await readBinaryFromMongo(container, id);
        expect(mongoDocAfterCreate).toBeDefined();
        const liveKey = `Binary_4_0_0/${mongoDocAfterCreate._uuid}`;
        expect(liveClient.uploadedData[liveKey]).toBe(LARGE_DATA);

        // Patch out the data field entirely.
        await request
            .patch(`/4_0_0/Binary/${id}`)
            .send([{ op: 'remove', path: '/data' }])
            .set({ ...getHeaders(), 'Content-Type': 'application/json-patch+json' })
            .expect(200);
        await drainPostRequest(container);

        // Live S3 object should be gone.
        expect(liveClient.uploadedData[liveKey]).toBeUndefined();

        // Mongo doc should have no data and no _blobMeta.
        const mongoDocAfterPatch = await readBinaryFromMongo(container, id);
        expect(mongoDocAfterPatch).toBeDefined();
        expect(mongoDocAfterPatch.data).toBeUndefined();
        expect(mongoDocAfterPatch._blobMeta).toBeUndefined();

        // History diagnostic for the `remove` op must NOT have a fabricated `value` field —
        // RFC 6902 `remove` ops have no `value`, so the sanitizer must leave them alone.
        const historyDocs = await readBinaryHistoryFromMongo(container);
        const removeDiagnostics = historyDocs
            .filter(d => d.resource && d.resource._uuid === mongoDocAfterCreate._uuid)
            .map(d => d.response && d.response.outcome && d.response.outcome.issue)
            .filter(Array.isArray)
            .flat()
            .map(issue => issue.diagnostics)
            .filter(Boolean)
            .map(s => { try { return JSON.parse(s); } catch (e) { return null; } })
            .filter(p => p && p.op === 'remove' && p.path === '/data');
        expect(removeDiagnostics.length).toBeGreaterThan(0);
        for (const patch of removeDiagnostics) {
            expect('value' in patch).toBe(false);
        }
    });

    test('GraphQL v1 returns Binary.data hydrated from S3', async () => {
        const request = await createTestRequest(registerMockClients);
        const container = getTestContainer();
        const liveClient = container.base64FieldCloudStorageClient;
        const id = 'binary-graphql-v1';

        await request
            .put(`/4_0_0/Binary/${id}`)
            .send(buildBinary({ id, data: LARGE_DATA }))
            .set(getHeaders())
            .expect(201);
        await drainPostRequest(container);

        const mongoDoc = await readBinaryFromMongo(container, id);
        expect(mongoDoc).toBeDefined();
        expect(mongoDoc.data).toBeUndefined();
        expect(mongoDoc._blobMeta).toBeDefined();

        const downloadSpy = jest.spyOn(liveClient, 'downloadAsync');
        try {
            const query = `query { binary(_id: { value: "${id}" }) { entry { resource { id contentType data } } } }`;
            const resp = await request
                .post('/$graphql')
                .send({ operationName: null, variables: {}, query })
                .set(getGraphQLHeaders())
                .expect(200);

            const entries = (resp.body && resp.body.data && resp.body.data.binary && resp.body.data.binary.entry) || [];
            expect(entries).toHaveLength(1);
            const resource = entries[0].resource;
            expect(resource.id).toBe(id);
            expect(resource.contentType).toBe('application/pdf');
            expect(downloadSpy).toHaveBeenCalled();
            expect(downloadSpy).toHaveBeenCalledWith(`Binary_4_0_0/${mongoDoc._uuid}`);
            expect(resource.data).toBe(LARGE_DATA);
        } finally {
            downloadSpy.mockRestore();
        }
    });

    test('GraphQL v2 returns Binary.data hydrated from S3', async () => {
        const request = await createTestRequest(registerMockClients);
        const container = getTestContainer();
        const liveClient = container.base64FieldCloudStorageClient;
        const id = 'binary-graphql-v2';

        await request
            .put(`/4_0_0/Binary/${id}`)
            .send(buildBinary({ id, data: LARGE_DATA }))
            .set(getHeaders())
            .expect(201);
        await drainPostRequest(container);

        const mongoDoc = await readBinaryFromMongo(container, id);
        expect(mongoDoc).toBeDefined();
        expect(mongoDoc.data).toBeUndefined();
        expect(mongoDoc._blobMeta).toBeDefined();

        const downloadSpy = jest.spyOn(liveClient, 'downloadAsync');
        try {
            const query = `query { binaries(id: { value: "${id}" }) { entry { resource { id contentType data } } } }`;
            const resp = await request
                .post('/4_0_0/$graphqlv2')
                .send({ operationName: null, variables: {}, query })
                .set(getGraphQLHeaders())
                .expect(200);

            const entries = (resp.body && resp.body.data && resp.body.data.binaries && resp.body.data.binaries.entry) || [];
            expect(entries).toHaveLength(1);
            const resource = entries[0].resource;
            // GraphQL v2 returns _uuid in the id field (consistent with other v2 fixtures).
            expect(resource.id).toBe(mongoDoc._uuid);
            expect(resource.contentType).toBe('application/pdf');
            expect(downloadSpy).toHaveBeenCalled();
            expect(downloadSpy).toHaveBeenCalledWith(`Binary_4_0_0/${mongoDoc._uuid}`);
            expect(resource.data).toBe(LARGE_DATA);
        } finally {
            downloadSpy.mockRestore();
        }
    });

    test('shrink-below-threshold update deletes the orphaned live S3 object', async () => {
        const request = await createTestRequest(registerMockClients);
        const container = getTestContainer();
        const liveClient = container.base64FieldCloudStorageClient;
        const id = 'binary-shrink-target';

        await request
            .put(`/4_0_0/Binary/${id}`)
            .send(buildBinary({ id, data: LARGE_DATA }))
            .set(getHeaders())
            .expect(201);
        await drainPostRequest(container);

        const mongoDocAfterCreate = await readBinaryFromMongo(container, id);
        expect(mongoDocAfterCreate).toBeDefined();
        const liveKey = `Binary_4_0_0/${mongoDocAfterCreate._uuid}`;
        expect(liveClient.uploadedData[liveKey]).toBe(LARGE_DATA);

        // PUT with a small payload — should trigger orphan cleanup of the live S3 object.
        await request
            .put(`/4_0_0/Binary/${id}`)
            .send(buildBinary({ id, data: SMALL_DATA }))
            .set(getHeaders())
            .expect(200);
        await drainPostRequest(container);

        // Live key should be gone.
        expect(liveClient.uploadedData[liveKey]).toBeUndefined();

        // Mongo doc should have inline data and no _blobMeta.
        const mongoDocAfterUpdate = await readBinaryFromMongo(container, id);
        expect(mongoDocAfterUpdate.data).toBe(SMALL_DATA);
        expect(mongoDocAfterUpdate._blobMeta).toBeUndefined();
    });

    test('$graph hydrates Binary start resource from S3', async () => {
        const request = await createTestRequest(registerMockClients);
        const container = getTestContainer();
        const liveClient = container.base64FieldCloudStorageClient;
        const binaryId = 'binary-graph-start';

        // Seed an externalized Binary.
        await request
            .put(`/4_0_0/Binary/${binaryId}`)
            .send(buildBinary({ id: binaryId, data: LARGE_DATA }))
            .set(getHeaders())
            .expect(201);
        await drainPostRequest(container);

        const mongoBinaryDoc = await readBinaryFromMongo(container, binaryId);
        expect(mongoBinaryDoc).toBeDefined();
        expect(mongoBinaryDoc.data).toBeUndefined();
        expect(mongoBinaryDoc._blobMeta).toBeDefined();
        const liveKey = `Binary_4_0_0/${mongoBinaryDoc._uuid}`;
        expect(liveClient.uploadedData[liveKey]).toBe(LARGE_DATA);

        const graphDefinition = {
            resourceType: 'GraphDefinition',
            id: 'binary-only',
            name: 'binary_only',
            status: 'active',
            start: 'Binary'
        };

        const downloadSpy = jest.spyOn(liveClient, 'downloadAsync');
        try {
            const resp = await request
                .post(`/4_0_0/Binary/$graph?id=${binaryId}&contained=false`)
                .send(graphDefinition)
                .set(getHeaders())
                .expect(200);

            expect(resp.body.resourceType).toBe('Bundle');
            const entries = resp.body.entry || [];
            const binaryEntry = entries.find(e => e.resource && e.resource.resourceType === 'Binary');
            expect(binaryEntry).toBeDefined();
            expect(binaryEntry.resource.id).toBe(binaryId);
            expect(binaryEntry.resource.data).toBe(LARGE_DATA);
            expect(binaryEntry.resource._blobMeta).toBeUndefined();
            expect(downloadSpy).toHaveBeenCalled();
            expect(downloadSpy).toHaveBeenCalledWith(`Binary_4_0_0/${mongoBinaryDoc._uuid}`);
        } finally {
            downloadSpy.mockRestore();
        }
    });

    test('Cold read fails with 5xx OperationOutcome when live S3 object is missing', async () => {
        const request = await createTestRequest(registerMockClients);
        const container = getTestContainer();
        const liveClient = container.base64FieldCloudStorageClient;
        const id = 'binary-cold-read-missing';

        await request
            .put(`/4_0_0/Binary/${id}`)
            .send(buildBinary({ id, data: LARGE_DATA }))
            .set(getHeaders())
            .expect(201);
        await drainPostRequest(container);

        const mongoDoc = await readBinaryFromMongo(container, id);
        expect(mongoDoc).toBeDefined();
        const liveKey = `Binary_4_0_0/${mongoDoc._uuid}`;
        expect(liveClient.uploadedData[liveKey]).toBe(LARGE_DATA);

        // Simulate an orphaned _blobMeta: the sidecar remains but the S3 object is gone.
        delete liveClient.uploadedData[liveKey];

        const resp = await request
            .get(`/4_0_0/Binary/${id}`)
            .set(getHeaders());

        expect(resp.status).toBeGreaterThanOrEqual(500);
        expect(resp).toHaveResponse({
            issue: [
                { code: 'internal', details: { text: 'Internal Server Error' }, severity: 'error' }
            ],
            resourceType: 'OperationOutcome'
        });
    });

    test('$everything hydrates Binary reachable via DocumentReference in patient compartment', async () => {
        const request = await createTestRequest(registerMockClients);
        const container = getTestContainer();
        const liveClient = container.base64FieldCloudStorageClient;
        const patientId = 'patient-everything-binary';
        const docRefId = 'docref-everything-binary';
        const binaryId = 'binary-everything-target';

        const patientResource = {
            resourceType: 'Patient',
            id: patientId,
            meta: {
                source: 'https://test.example.com/source',
                security: [
                    { system: 'https://www.icanbwell.com/owner', code: 'test' },
                    { system: 'https://www.icanbwell.com/access', code: 'test' },
                    { system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'test' }
                ]
            },
            birthDate: '2000-01-01',
            gender: 'female'
        };

        const documentReferenceResource = {
            resourceType: 'DocumentReference',
            id: docRefId,
            meta: {
                source: 'https://test.example.com/source',
                security: [
                    { system: 'https://www.icanbwell.com/owner', code: 'test' },
                    { system: 'https://www.icanbwell.com/access', code: 'test' },
                    { system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'test' }
                ]
            },
            status: 'current',
            subject: { reference: `Patient/${patientId}` },
            content: [
                {
                    attachment: {
                        contentType: 'application/pdf',
                        url: `Binary/${binaryId}`
                    }
                }
            ]
        };

        await request
            .post('/4_0_0/Patient/$merge')
            .send(patientResource)
            .set(getHeaders())
            .expect(200);
        await request
            .post('/4_0_0/DocumentReference/$merge')
            .send(documentReferenceResource)
            .set(getHeaders())
            .expect(200);
        await request
            .put(`/4_0_0/Binary/${binaryId}`)
            .send(buildBinary({ id: binaryId, data: LARGE_DATA }))
            .set(getHeaders())
            .expect(201);
        await drainPostRequest(container);

        const mongoBinaryDoc = await readBinaryFromMongo(container, binaryId);
        expect(mongoBinaryDoc).toBeDefined();
        expect(mongoBinaryDoc.data).toBeUndefined();
        expect(mongoBinaryDoc._blobMeta).toBeDefined();
        const liveKey = `Binary_4_0_0/${mongoBinaryDoc._uuid}`;
        expect(liveClient.uploadedData[liveKey]).toBe(LARGE_DATA);

        const downloadSpy = jest.spyOn(liveClient, 'downloadAsync');
        try {
            const resp = await request
                .get(`/4_0_0/Patient/${patientId}/$everything`)
                .set(getHeaders())
                .expect(200);

            expect(resp.body.resourceType).toBe('Bundle');
            const entries = resp.body.entry || [];
            const binaryEntry = entries.find(
                e => e.resource && e.resource.resourceType === 'Binary'
            );
            expect(binaryEntry).toBeDefined();
            expect(binaryEntry.resource.data).toBe(LARGE_DATA);
            expect(binaryEntry.resource._blobMeta).toBeUndefined();
            expect(downloadSpy).toHaveBeenCalledWith(liveKey);
        } finally {
            downloadSpy.mockRestore();
        }
    });

    test('GET /Binary/{id}/_history and /Binary/{id}/_history/{vid} both read externalized data from history bucket', async () => {
        const request = await createTestRequest(registerMockClients);
        const container = getTestContainer();
        const liveClient = container.base64FieldCloudStorageClient;
        const historyClient = container.historyResourceCloudStorageClient;
        // Both endpoints exercise the same instance — fixture ids match this id.
        const id = 'binary-history-list';

        // First PUT — version 1 with LARGE_DATA.
        await request
            .put(`/4_0_0/Binary/${id}`)
            .send(buildBinary({ id, data: LARGE_DATA }))
            .set(getHeaders())
            .expect(201);
        await drainPostRequest(container);

        // Second PUT — version 2 with ALT_LARGE_DATA.
        await request
            .put(`/4_0_0/Binary/${id}`)
            .send(buildBinary({ id, data: ALT_LARGE_DATA }))
            .set(getHeaders())
            .expect(200);
        await drainPostRequest(container);

        const mongoDoc = await readBinaryFromMongo(container, id);
        expect(mongoDoc).toBeDefined();
        const uuid = mongoDoc._uuid;

        // Confirm history bucket contains both versions, keyed by epoch ms.
        const historyDocs = await readBinaryHistoryFromMongo(container);
        const matchedSnapshots = historyDocs.filter(d => d.resource && d.resource._uuid === uuid);
        const externalizedSnapshots = matchedSnapshots.filter(d => d.resource._blobMeta);
        expect(externalizedSnapshots.length).toBe(2);

        // Find the v1 snapshot up-front — we need its epoch ms for the version-read assertion.
        const v1Snapshot = matchedSnapshots.find(d => d.resource.meta && d.resource.meta.versionId === '1');
        expect(v1Snapshot).toBeDefined();
        expect(v1Snapshot.resource._blobMeta).toBeDefined();
        const v1EpochMs = new Date(v1Snapshot.resource.meta.lastUpdated).getTime();
        expect(Number.isFinite(v1EpochMs)).toBe(true);

        const liveDownloadSpy = jest.spyOn(liveClient, 'downloadAsync');
        const historyDownloadSpy = jest.spyOn(historyClient, 'downloadAsync');
        try {
            // --- Part 1: GET /_history (list of all versions) ---
            const historyListResp = await request
                .get(`/4_0_0/Binary/${id}/_history`)
                .set(getHeaders())
                .expect(200);

            // Inject dynamic values (entry.id = resource _uuid, inline data payloads) into the
            // fixture before whole-response comparison. `_blobMeta` is intentionally absent from
            // the fixture — the serializer strips it from the response.
            const expectedHistoryList = JSON.parse(
                JSON.stringify(expectedBinaryHistoryListResponse)
                    .replace(/__BINARY_UUID__/g, uuid)
                    .replace(/__ALT_LARGE_DATA__/g, ALT_LARGE_DATA)
                    .replace(/__LARGE_DATA__/g, LARGE_DATA)
            );
            expect(historyListResp).toHaveResponse(expectedHistoryList);

            // History reads must use the history bucket, not the live one. The matcher only
            // covers the HTTP response — bucket dispatch is observable solely via the spies.
            expect(historyDownloadSpy).toHaveBeenCalledTimes(2);
            expect(liveDownloadSpy).not.toHaveBeenCalled();

            // Reset only the call history so the per-version assertion below is clean. Keep the
            // same spy instances to preserve the linear flow of the test.
            historyDownloadSpy.mockClear();

            // --- Part 2: GET /_history/1 (specific version read) ---
            const versionReadResp = await request
                .get(`/4_0_0/Binary/${id}/_history/1`)
                .set(getHeaders())
                .expect(200);

            // Inject the inline data payload into the fixture. `_blobMeta` is intentionally
            // absent from the fixture — the serializer strips it from the response. The fixture
            // currently carries the legacy id 'binary-history-version', so swap it to the id
            // used in this combined test.
            const expectedVersionRead = JSON.parse(
                JSON.stringify(expectedBinaryHistoryVersionReadResponse)
                    .replace('binary-history-version', id)
                    .replace('__LARGE_DATA__', LARGE_DATA)
            );
            expect(versionReadResp).toHaveResponse(expectedVersionRead);

            // The matcher only verifies the HTTP response — assert the version-specific
            // history-bucket key was used via the spy.
            expect(historyDownloadSpy).toHaveBeenCalledTimes(1);
            expect(historyDownloadSpy).toHaveBeenCalledWith(`Binary_4_0_0/${uuid}/${v1EpochMs}`);
            expect(liveDownloadSpy).not.toHaveBeenCalled();
        } finally {
            liveDownloadSpy.mockRestore();
            historyDownloadSpy.mockRestore();
        }
    });

    test('GET /Binary/_history returns externalized data from history bucket across all Binaries', async () => {
        const request = await createTestRequest(registerMockClients);
        const container = getTestContainer();
        const liveClient = container.base64FieldCloudStorageClient;
        const historyClient = container.historyResourceCloudStorageClient;
        const idA = 'binary-history-type-A';
        const idB = 'binary-history-type-B';

        // Two DIFFERENT Binaries — each becomes one history entry (single PUT, no updates).
        await request
            .put(`/4_0_0/Binary/${idA}`)
            .send(buildBinary({ id: idA, data: LARGE_DATA }))
            .set(getHeaders())
            .expect(201);
        await drainPostRequest(container);

        await request
            .put(`/4_0_0/Binary/${idB}`)
            .send(buildBinary({ id: idB, data: ALT_LARGE_DATA }))
            .set(getHeaders())
            .expect(201);
        await drainPostRequest(container);

        const mongoDocA = await readBinaryFromMongo(container, idA);
        const mongoDocB = await readBinaryFromMongo(container, idB);
        expect(mongoDocA).toBeDefined();
        expect(mongoDocB).toBeDefined();
        const uuidA = mongoDocA._uuid;
        const uuidB = mongoDocB._uuid;

        // Both versions must be externalized in the history bucket.
        const historyDocs = await readBinaryHistoryFromMongo(container);
        const snapA = historyDocs.find(
            d => d.resource && d.resource._uuid === uuidA && d.resource.meta && d.resource.meta.versionId === '1'
        );
        const snapB = historyDocs.find(
            d => d.resource && d.resource._uuid === uuidB && d.resource.meta && d.resource.meta.versionId === '1'
        );
        expect(snapA).toBeDefined();
        expect(snapB).toBeDefined();
        expect(snapA.resource._blobMeta).toBeDefined();
        expect(snapB.resource._blobMeta).toBeDefined();
        const epochMsA = new Date(snapA.resource.meta.lastUpdated).getTime();
        const epochMsB = new Date(snapB.resource.meta.lastUpdated).getTime();
        expect(Number.isFinite(epochMsA)).toBe(true);
        expect(Number.isFinite(epochMsB)).toBe(true);

        const liveDownloadSpy = jest.spyOn(liveClient, 'downloadAsync');
        const historyDownloadSpy = jest.spyOn(historyClient, 'downloadAsync');
        try {
            const resp = await request
                .get('/4_0_0/Binary/_history')
                .set(getHeaders())
                .expect(200);

            const expectedTypeHistory = JSON.parse(
                JSON.stringify(expectedBinaryTypeHistoryResponse)
                    .replace(/__BINARY_A_UUID__/g, uuidA)
                    .replace(/__BINARY_B_UUID__/g, uuidB)
                    .replace(/__LARGE_DATA__/g, LARGE_DATA)
                    .replace(/__ALT_LARGE_DATA__/g, ALT_LARGE_DATA)
            );
            expect(resp).toHaveResponse(expectedTypeHistory);

            // One history-bucket download per externalized version (one per binary).
            expect(historyDownloadSpy).toHaveBeenCalledTimes(2);
            expect(liveDownloadSpy).not.toHaveBeenCalled();
        } finally {
            liveDownloadSpy.mockRestore();
            historyDownloadSpy.mockRestore();
        }
    });

    test('Threshold flip-flop: history diagnostics sanitize only the versions that externalized', async () => {
        const request = await createTestRequest(registerMockClients);
        const container = getTestContainer();
        const liveClient = container.base64FieldCloudStorageClient;
        const historyClient = container.historyResourceCloudStorageClient;
        const id = 'binary-history-flip-flop';

        // v1 — below threshold (inline, no S3 traffic).
        await request
            .put(`/4_0_0/Binary/${id}`)
            .send(buildBinary({ id, data: SMALL_DATA }))
            .set(getHeaders())
            .expect(201);
        await drainPostRequest(container);

        // v2 — above threshold (externalized).
        await request
            .put(`/4_0_0/Binary/${id}`)
            .send(buildBinary({ id, data: LARGE_DATA }))
            .set(getHeaders())
            .expect(200);
        await drainPostRequest(container);

        // v3 — below threshold again (inline; this version's diagnostic must NOT be sanitized).
        await request
            .put(`/4_0_0/Binary/${id}`)
            .send(buildBinary({ id, data: SMALL_DATA }))
            .set(getHeaders())
            .expect(200);
        await drainPostRequest(container);

        // v4 — above threshold again (externalized).
        await request
            .put(`/4_0_0/Binary/${id}`)
            .send(buildBinary({ id, data: LARGE_DATA }))
            .set(getHeaders())
            .expect(200);
        await drainPostRequest(container);

        const mongoDoc = await readBinaryFromMongo(container, id);
        expect(mongoDoc).toBeDefined();
        const uuid = mongoDoc._uuid;

        // Sanity-check the per-version sidecar state in Mongo history so the assertion below
        // is grounded in observed behavior, not a stale expectation: only the over-threshold
        // versions (v2 and v4) carry `_blobMeta`; the inline versions (v1 and v3) do not.
        const historyDocs = await readBinaryHistoryFromMongo(container);
        const matchedSnapshots = historyDocs.filter(d => d.resource && d.resource._uuid === uuid);
        expect(matchedSnapshots.length).toBe(4);
        const byVersion = Object.fromEntries(
            matchedSnapshots.map(d => [d.resource.meta.versionId, d])
        );
        expect(byVersion['1'].resource._blobMeta).toBeUndefined();
        expect(byVersion['2'].resource._blobMeta).toBeDefined();
        expect(byVersion['3'].resource._blobMeta).toBeUndefined();
        expect(byVersion['4'].resource._blobMeta).toBeDefined();

        const liveDownloadSpy = jest.spyOn(liveClient, 'downloadAsync');
        const historyDownloadSpy = jest.spyOn(historyClient, 'downloadAsync');
        try {
            const historyListResp = await request
                .get(`/4_0_0/Binary/${id}/_history`)
                .set(getHeaders())
                .expect(200);

            // The /_history operation runs its per-entry rehydration via `Promise.all`, which
            // makes the returned `entry[]` order non-deterministic when multiple versions land
            // in the same response. Sort by versionId ascending in both the response and the
            // fixture so the whole-bundle assertion is comparing apples to apples — the order
            // isn't part of what this test cares about; the content per version is.
            historyListResp.body.entry.sort(
                (a, b) => Number(a.resource.meta.versionId) - Number(b.resource.meta.versionId)
            );

            // Substitute dynamic values into the fixture. The diagnostic for v3 carries the
            // real (small) base64 payload — this is the BUG-FIX assertion: below-threshold
            // versions must keep their actual patch value, not the `<data_value>` placeholder.
            const expectedFlipFlop = JSON.parse(
                JSON.stringify(expectedBinaryThresholdFlipFlopHistoryResponse)
                    .replace(/__BINARY_UUID__/g, uuid)
                    .replace(/__LARGE_DATA__/g, LARGE_DATA)
                    .replace(/__SMALL_DATA__/g, SMALL_DATA)
            );
            expect(historyListResp).toHaveResponse(expectedFlipFlop);

            // Only v2 and v4 externalized — those are the only versions that need rehydration
            // from the history bucket. v1 and v3 are inline in Mongo (no S3 fetch needed).
            expect(historyDownloadSpy).toHaveBeenCalledTimes(2);
            expect(liveDownloadSpy).not.toHaveBeenCalled();
        } finally {
            liveDownloadSpy.mockRestore();
            historyDownloadSpy.mockRestore();
        }
    });
});
