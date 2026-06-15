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
    getTestContainer,
    mockHttpContext
} = require('../../common');
const { MockS3Client } = require('../../export/mocks/s3Client');
const { CLOUD_STORAGE_CLIENTS } = require('../../../constants');

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
    });

    test('PATCH /data sanitizes patch diagnostics with <data_value> placeholder', async () => {
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

        // History entry's diagnostics should carry the patch shape but with `<data_value>` substituted.
        const historyDocs = await readBinaryHistoryFromMongo(container);
        const matchedSnapshots = historyDocs.filter(d => d.resource && d.resource._uuid === mongoDocAfterCreate._uuid);
        const patchEntries = matchedSnapshots
            .map(d => d.response && d.response.outcome && d.response.outcome.issue)
            .filter(Array.isArray)
            .flat();
        const dataPatchDiagnostics = patchEntries
            .map(issue => issue.diagnostics)
            .filter(Boolean)
            .map(s => {
                try { return JSON.parse(s); } catch (e) { return null; }
            })
            .filter(p => p && p.path === '/data');

        expect(dataPatchDiagnostics.length).toBeGreaterThan(0);
        for (const patch of dataPatchDiagnostics) {
            expect(patch.value).toBe('<data_value>');
        }
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
});
