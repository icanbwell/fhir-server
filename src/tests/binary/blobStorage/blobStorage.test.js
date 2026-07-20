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
    getTestRequestInfo,
    mockHttpContext
} = require('../../common');
const { MockS3Client } = require('../../export/mocks/s3Client');
const { CLOUD_STORAGE_CLIENTS, BLOB_OP } = require('../../../constants');

// 80 KB string — exceeds the 64 KB default threshold and triggers S3 offload.
const LARGE_DATA = 'A'.repeat(80 * 1024);
// 1 KB string — stays inline.
const SMALL_DATA = 'B'.repeat(1024);
// 70 KB replacement payload — also above threshold, used to test PUT-overwriting an externalized Binary.
const ALT_LARGE_DATA = 'C'.repeat(70 * 1024);
// Short, valid base64 stand-in swapped over the real `data` before a whole-resource
// toHaveResponse comparison. The matcher walks the `data` string char-by-char and
// FHIR-validates the body, which is pathologically slow on an 80 KB payload; the real
// content is asserted separately with a direct string compare.
const DATA_PLACEHOLDER = 'AAAA';

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

/**
 * Whole-resource shape the server returns for a Binary created by `buildBinary` above.
 * `id` is injected per-test (server-generated on POST); `meta.lastUpdated` is stripped by
 * the toHaveResponse matcher. The `meta.security` tag ids are the deterministic UUIDv5
 * values preSave derives from system|code, so they are stable across runs.
 */
const buildExpectedBinary = ({ id, data, versionId = '1' }) => ({
    resourceType: 'Binary',
    id,
    meta: {
        versionId,
        source: 'https://test.example.com/source',
        security: [
            { id: '393b248d-39c0-5a90-8833-2ba9ad8e78fc', system: 'https://www.icanbwell.com/owner', code: 'test' },
            { id: 'ef7e6bf0-3950-5433-b871-0fc6a7e1573e', system: 'https://www.icanbwell.com/access', code: 'test' },
            { id: '48850590-7eb6-51cd-8556-5c574aad2782', system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'test' }
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
            if (liveClient) { liveClient.uploadedData = {}; liveClient.copyCalls = []; }
            if (historyClient) { historyClient.uploadedData = {}; historyClient.copyCalls = []; }
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

    // Live-bucket key for a Binary doc: `{ResourceType}_4_0_0/{uuid}/{lastUpdatedEpochMs}`. The live
    // key is timestamped (not a bare uuid) and rotates on every PUT/PATCH, so it must be derived
    // from the doc's current `_blobMeta.lastUpdated` rather than hardcoded.
    const liveKeyOf = (doc) => `Binary_4_0_0/${doc._uuid}/${doc._blobMeta.lastUpdated.getTime()}`;

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
        // `hash` is the content hash (drives the history key + change detection), not the uuid.
        expect(typeof mongoDoc._blobMeta.hash).toBe('string');
        expect(mongoDoc._blobMeta.hash.length).toBeGreaterThan(0);
        expect(mongoDoc._blobMeta.rawSize).toBe(80);

        // Live S3 should have the payload at the timestamped key.
        expect(liveClient.uploadedData[liveKeyOf(mongoDoc)]).toBe(LARGE_DATA);
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

    test('PUT update rotates the live key + appends a hash-keyed history object', async () => {
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

        const docV1 = await readBinaryFromMongo(container, id);
        const keyV1 = liveKeyOf(docV1);
        expect(liveClient.uploadedData[keyV1]).toBe(LARGE_DATA);

        // Now PUT with a different above-threshold payload.
        await request
            .put(`/4_0_0/Binary/${id}`)
            .send(buildBinary({ id, data: ALT_LARGE_DATA }))
            .set(getHeaders())
            .expect(200);
        await drainPostRequest(container);

        // Live key ROTATED: the new version lives at a fresh timestamped key holding the new
        // payload, and the superseded v1 object was cleaned up.
        const docV2 = await readBinaryFromMongo(container, id);
        const keyV2 = liveKeyOf(docV2);
        expect(keyV2).not.toBe(keyV1);
        expect(liveClient.uploadedData[keyV2]).toBe(ALT_LARGE_DATA);
        expect(liveClient.uploadedData[keyV1]).toBeUndefined();

        // History bucket is content-addressed: `Binary_4_0_0/{uuid}/{hash}`. Two distinct payloads
        // (LARGE + ALT) => two distinct history objects; the suffix is a base64url hash, not an epoch.
        const versionedKeys = Object.keys(historyClient.uploadedData)
            .filter(k => k.startsWith(`Binary_4_0_0/${docV1._uuid}/`));
        expect(versionedKeys.length).toBe(2);
        for (const key of versionedKeys) {
            const suffix = key.replace(`Binary_4_0_0/${docV1._uuid}/`, '');
            expect(suffix).toMatch(/^[A-Za-z0-9_-]+$/);
        }

        // History Mongo snapshots reference the content by `_blobMeta.hash`, carry no inline data.
        const historyDocs = await readBinaryHistoryFromMongo(container);
        const matchedSnapshots = historyDocs.filter(d => d.resource && d.resource._uuid === docV1._uuid);
        expect(matchedSnapshots.length).toBeGreaterThan(0);
        for (const entry of matchedSnapshots) {
            if (entry.resource._blobMeta) {
                expect(typeof entry.resource._blobMeta.hash).toBe('string');
                expect(entry.resource._blobMeta.lastUpdated).toBeDefined();
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

        // Patch the data field with a new above-threshold payload.
        await request
            .patch(`/4_0_0/Binary/${id}`)
            .send([{ op: 'replace', path: '/data', value: ALT_LARGE_DATA }])
            .set({ ...getHeaders(), 'Content-Type': 'application/json-patch+json' })
            .expect(200);
        await drainPostRequest(container);

        // New content lives at the patched version's (rotated) timestamped live key.
        const docAfterPatch = await readBinaryFromMongo(container, id);
        expect(liveClient.uploadedData[liveKeyOf(docAfterPatch)]).toBe(ALT_LARGE_DATA);

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
        expect(liveClient.uploadedData[liveKeyOf(largeDoc)]).toBe(LARGE_DATA);

        // Small → inline; nothing landed in the live bucket for its uuid.
        expect(smallDoc.data).toBe(SMALL_DATA);
        expect(smallDoc._blobMeta).toBeUndefined();
        expect(Object.keys(liveClient.uploadedData).some(k => k.startsWith(`Binary_4_0_0/${smallDoc._uuid}/`))).toBe(false);
    });

    test('$merge changing the data rotates the live key AND deletes the superseded live object', async () => {
        // The merged doc inherits the current version's `_blobMeta`, so the data-change upload
        // branch rotates to a fresh key. The superseded key must be deleted post-commit — the same
        // cleanup PUT/PATCH get, driven off the recorded previous key rather than `alwaysCreateNew`.
        const request = await createTestRequest(registerMockClients);
        const container = getTestContainer();
        const liveClient = container.base64FieldCloudStorageClient;
        const id = 'binary-merge-change-cleanup';

        // Seed an externalized Binary.
        await request
            .put(`/4_0_0/Binary/${id}`)
            .send(buildBinary({ id, data: LARGE_DATA }))
            .set(getHeaders())
            .expect(201);
        await drainPostRequest(container);

        const docV1 = await readBinaryFromMongo(container, id);
        const keyV1 = liveKeyOf(docV1);
        expect(liveClient.uploadedData[keyV1]).toBe(LARGE_DATA);

        // $merge a DIFFERENT above-threshold payload → data change on the existing resource.
        await request
            .post('/4_0_0/Binary/$merge')
            .send(buildBinary({ id, data: ALT_LARGE_DATA }))
            .set(getHeaders())
            .expect(200);
        await drainPostRequest(container);

        const docV2 = await readBinaryFromMongo(container, id);
        const keyV2 = liveKeyOf(docV2);

        // New live object holds the new bytes at a fresh key...
        expect(keyV2).not.toBe(keyV1);
        expect(liveClient.uploadedData[keyV2]).toBe(ALT_LARGE_DATA);
        // ...and the superseded live object is gone (the bug: it used to linger orphaned).
        expect(liveClient.uploadedData[keyV1]).toBeUndefined();
    });

    test('$merge self-heals when the referenced live object is missing: re-uploads incoming data instead of erroring', async () => {
        // A prior version externalized `data`, but its live object was lost from S3 (deleted out of
        // band / TTL expired). RETRIEVE of the current version can't find it — but the incoming
        // $merge carries fresh `data`, so it must NOT 500: log the miss and let INSERT re-upload.
        const request = await createTestRequest(registerMockClients);
        const container = getTestContainer();
        const liveClient = container.base64FieldCloudStorageClient;
        const id = 'binary-merge-missing-live';

        await request
            .put(`/4_0_0/Binary/${id}`)
            .send(buildBinary({ id, data: LARGE_DATA }))
            .set(getHeaders())
            .expect(201);
        await drainPostRequest(container);

        const docV1 = await readBinaryFromMongo(container, id);
        const keyV1 = liveKeyOf(docV1);
        expect(liveClient.uploadedData[keyV1]).toBe(LARGE_DATA);

        // Simulate the live object vanishing from S3.
        delete liveClient.uploadedData[keyV1];

        // $merge new above-threshold data — must succeed despite the missing current live object.
        await request
            .post('/4_0_0/Binary/$merge')
            .send(buildBinary({ id, data: ALT_LARGE_DATA }))
            .set(getHeaders())
            .expect(200);
        await drainPostRequest(container);

        // Self-healed: fresh live object holds the incoming bytes, sidecar points at it, and the
        // stale (missing) key is not referenced.
        const docV2 = await readBinaryFromMongo(container, id);
        expect(docV2._blobMeta).toBeDefined();
        const keyV2 = liveKeyOf(docV2);
        expect(keyV2).not.toBe(keyV1);
        expect(liveClient.uploadedData[keyV2]).toBe(ALT_LARGE_DATA);
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
        const liveKey = liveKeyOf(mongoDocAfterCreate);
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
        const liveKey = liveKeyOf(mongoDocAfterCreate);
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
        const liveKey = liveKeyOf(mongoDocAfterCreate);
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

    const historyKeysFor = (historyClient, uuid) =>
        Object.keys(historyClient.uploadedData).filter(k => k.startsWith(`Binary_4_0_0/${uuid}/`));

    // History-collection snapshots for a uuid, sorted ascending by versionId.
    const historySnapshotsFor = async (container, uuid) => {
        const docs = await readBinaryHistoryFromMongo(container);
        return docs
            .filter(d => d.resource && d.resource._uuid === uuid)
            .map(d => d.resource)
            .sort((a, b) => parseInt(a.meta.versionId, 10) - parseInt(b.meta.versionId, 10));
    };

    test('concurrency-retry replaceOneAsync on an externalized Binary keeps content + _blobMeta consistent', async () => {
        const request = await createTestRequest(registerMockClients);
        const container = getTestContainer();
        const liveClient = container.base64FieldCloudStorageClient;
        const id = 'binary-retry-target';

        await request
            .put(`/4_0_0/Binary/${id}`)
            .send(buildBinary({ id, data: LARGE_DATA }))
            .set(getHeaders())
            .expect(201);
        await drainPostRequest(container);

        const dbDoc = await readBinaryFromMongo(container, id);
        expect(dbDoc._blobMeta).toBeDefined();
        expect(dbDoc.data).toBeUndefined();
        const liveKey = liveKeyOf(dbDoc);
        expect(liveClient.uploadedData[liveKey]).toBe(LARGE_DATA);

        // Simulate the one-by-one concurrency retry input: the already-externalized doc
        // (data stripped, _blobMeta set) with a metadata-only change.
        const retryDoc = { ...dbDoc, contentType: 'application/xml' };
        delete retryDoc._id;

        const updateManager = container.databaseUpdateFactory.createFastDatabaseUpdateManager({
            resourceType: 'Binary',
            base_version: '4_0_0'
        });
        const requestInfo = getTestRequestInfo({ requestId: 'retry-req' });
        const { savedResource } = await updateManager.replaceOneAsync({
            base_version: '4_0_0',
            requestInfo,
            doc: retryDoc
        });

        // Retry must produce a valid state: metadata change applied, _blobMeta intact,
        // and the live object (which holds the payload) untouched — no data loss.
        expect(savedResource).toBeDefined();
        expect(savedResource.contentType).toBe('application/xml');
        expect(typeof savedResource._blobMeta.hash).toBe('string');
        expect(liveClient.uploadedData[liveKey]).toBe(LARGE_DATA);
    });

    test('payload-only concurrent update is forced through on retry (not silently dropped)', async () => {
        const request = await createTestRequest(registerMockClients);
        const container = getTestContainer();
        const b64 = container.base64DataManager;
        const liveClient = container.base64FieldCloudStorageClient;
        const id = 'binary-payload-only';

        // Seed v1 with a payload.
        await request
            .put(`/4_0_0/Binary/${id}`)
            .send(buildBinary({ id, data: LARGE_DATA }))
            .set(getHeaders())
            .expect(201);
        await drainPostRequest(container);

        const dbDoc = await readBinaryFromMongo(container, id);

        // Build the retry input: an externalized write that changes ONLY the base64 payload
        // (same contentType/meta) — the case where the FHIR diff can't see the change.
        const requestInfo = getTestRequestInfo({ requestId: 'payload-only-req' });
        const incoming = { ...dbDoc, data: ALT_LARGE_DATA };
        delete incoming._id;
        await b64.transformAsync(incoming, BLOB_OP.INSERT, requestInfo); // externalize: S3[U]=ALT, stash changed:true
        expect(incoming.data).toBeUndefined();
        expect(incoming._blobMeta).toBeDefined();

        const updateManager = container.databaseUpdateFactory.createFastDatabaseUpdateManager({
            resourceType: 'Binary',
            base_version: '4_0_0'
        });
        const { savedResource } = await updateManager.replaceOneAsync({
            base_version: '4_0_0',
            requestInfo,
            doc: incoming
        });

        // Must NOT be dropped: forced through as a new version, with the payload committed.
        expect(savedResource).not.toBeNull();
        expect(savedResource).toBeDefined();
        expect(savedResource.meta.versionId).toBe('2');

        const finalDoc = await readBinaryFromMongo(container, id);
        expect(finalDoc.meta.versionId).toBe('2');
        expect(typeof finalDoc._blobMeta.hash).toBe('string');
        expect(liveClient.uploadedData[liveKeyOf(finalDoc)]).toBe(ALT_LARGE_DATA);
    });

    test('payload-only concurrent update is forced through on the PUT (non-fast) retry path', async () => {
        const Binary = require('../../../fhir/classes/4_0_0/resources/binary');
        const request = await createTestRequest(registerMockClients);
        const container = getTestContainer();
        const b64 = container.base64DataManager;
        const liveClient = container.base64FieldCloudStorageClient;
        const id = 'binary-payload-only-put';

        // Seed v1 with a payload.
        await request
            .put(`/4_0_0/Binary/${id}`)
            .send(buildBinary({ id, data: LARGE_DATA }))
            .set(getHeaders())
            .expect(201);
        await drainPostRequest(container);

        const dbDoc = await readBinaryFromMongo(container, id);

        // Build a class-instance incoming write (as the PUT path uses) that changes ONLY the
        // payload; externalize it so it mirrors the doc reaching DatabaseUpdateManager on retry.
        const requestInfo = getTestRequestInfo({ requestId: 'payload-only-put-req' });
        const plain = { ...dbDoc, data: ALT_LARGE_DATA };
        delete plain._id;
        delete plain._blobMeta; // a fresh inline write carries no sidecar
        const incoming = new Binary(plain);
        await b64.transformAsync(incoming, BLOB_OP.INSERT, requestInfo);
        expect(incoming.data).toBeUndefined();
        expect(incoming._blobMeta).toBeDefined();

        const updateManager = container.databaseUpdateFactory.createDatabaseUpdateManager({
            resourceType: 'Binary',
            base_version: '4_0_0'
        });
        const { savedResource } = await updateManager.replaceOneAsync({
            base_version: '4_0_0',
            requestInfo,
            doc: incoming
        });

        // Must NOT be dropped: forced through as a new version, with the payload committed.
        expect(savedResource).not.toBeNull();
        expect(savedResource).toBeDefined();
        expect(savedResource.meta.versionId).toBe('2');

        const finalDoc = await readBinaryFromMongo(container, id);
        expect(finalDoc.meta.versionId).toBe('2');
        expect(typeof finalDoc._blobMeta.hash).toBe('string');
        expect(liveClient.uploadedData[liveKeyOf(finalDoc)]).toBe(ALT_LARGE_DATA);
    });

    test('retry reconciliation: caller data (A) overwrites a concurrent B and re-uploads A even though its original key was deleted', async () => {
        const Binary = require('../../../fhir/classes/4_0_0/resources/binary');
        const request = await createTestRequest(registerMockClients);
        const container = getTestContainer();
        const liveClient = container.base64FieldCloudStorageClient;
        const b64 = container.base64DataManager;
        const id = 'binary-merge-retry-rebase';

        // v1: caller R's data A externalized → key K_A.
        await request.put(`/4_0_0/Binary/${id}`).send(buildBinary({ id, data: LARGE_DATA })).set(getHeaders()).expect(201);
        await drainPostRequest(container);
        const v1 = await readBinaryFromMongo(container, id);
        const keyA = liveKeyOf(v1);
        const hashA = v1._blobMeta.hash;
        expect(liveClient.uploadedData[keyA]).toBe(LARGE_DATA);

        // Concurrent writer W commits data B (v2 → K_B); W's cleanup deletes the superseded K_A.
        await request.put(`/4_0_0/Binary/${id}`).send(buildBinary({ id, data: ALT_LARGE_DATA })).set(getHeaders()).expect(200);
        await drainPostRequest(container);
        const v2 = await readBinaryFromMongo(container, id);
        expect(liveClient.uploadedData[liveKeyOf(v2)]).toBe(ALT_LARGE_DATA);
        expect(liveClient.uploadedData[keyA]).toBeUndefined(); // K_A gone

        // R now reaches the version-checked manager: it read v1 and re-sends data A. R hash-skipped
        // the upload (data matched what it read), so its sidecar still points at the now-deleted
        // K_A and it never uploaded A itself. Its bytes survive only in the request stash
        // (currentData captured at RETRIEVE). Drive replaceOneAsync against the concurrently-moved DB.
        const requestInfo = getTestRequestInfo({ requestId: 'merge-retry-rebase-R' });
        const rDoc = new Binary({ ...v1 });
        delete rDoc._id;
        const dataSegments = ['data'];
        b64._stashCurrentData(requestInfo, rDoc._uuid, dataSegments, [], { content: LARGE_DATA, lastUpdated: v1._blobMeta.lastUpdated });
        b64._stashOriginalData(requestInfo, rDoc._uuid, dataSegments, [], { hash: hashA, changed: false });

        const mgr = container.databaseUpdateFactory.createDatabaseUpdateManager({ resourceType: 'Binary', base_version: '4_0_0' });
        const { savedResource } = await mgr.replaceOneAsync({ base_version: '4_0_0', requestInfo, doc: rDoc });
        expect(savedResource).not.toBeNull();

        // R's data A must WIN over the concurrent B, and it must live at a VALID (re-uploaded) key —
        // never a dangling reference to the deleted K_A.
        const committed = await readBinaryFromMongo(container, id);
        expect(committed._blobMeta.hash).toBe(hashA);
        const committedKey = liveKeyOf(committed);
        expect(committedKey).not.toBe(keyA); // fresh key — K_A was deleted, so A had to be re-uploaded
        expect(liveClient.uploadedData[committedKey]).toBe(LARGE_DATA);
    });

    test('unchanged-data $merge reuses the history object (hash-dedup) and refreshes its TTL', async () => {
        const request = await createTestRequest(registerMockClients);
        const container = getTestContainer();
        const historyClient = container.historyResourceCloudStorageClient;
        const id = 'binary-reuse-target';

        await request
            .put(`/4_0_0/Binary/${id}`)
            .send(buildBinary({ id, data: LARGE_DATA }))
            .set(getHeaders())
            .expect(201);
        await drainPostRequest(container);

        const docV1 = await readBinaryFromMongo(container, id);
        const uuid = docV1._uuid;
        expect(typeof docV1._blobMeta.hash).toBe('string');
        const v1Stamp = docV1._blobMeta.lastUpdated;
        expect(v1Stamp).toBeDefined();
        // Stored as a BSON Date in Mongo, matching meta.lastUpdated.
        expect(v1Stamp).toBeInstanceOf(Date);
        const histKeysV1 = historyKeysFor(historyClient, uuid);
        expect(histKeysV1.length).toBe(1);
        const v1HistoryKey = histKeysV1[0];
        historyClient.copyCalls = [];

        // Metadata-only $merge: same payload, different contentType. $merge uses the hash-skip path
        // (data unchanged), which keeps the content stamp stable and refreshes the existing history
        // object's TTL via copy-onto-self — unlike PUT/PATCH, which always rotate to a fresh key.
        await request
            .post(`/4_0_0/Binary/$merge`)
            .send({ ...buildBinary({ id, data: LARGE_DATA }), contentType: 'application/xml' })
            .set(getHeaders())
            .expect(200);
        await drainPostRequest(container);

        // No NEW history object (same hash); the existing one had its TTL refreshed via copy-onto-self.
        expect(historyKeysFor(historyClient, uuid)).toEqual(histKeysV1);
        expect(historyClient.copyCalls).toContain(v1HistoryKey);

        // $merge kept the content stamp stable (data unchanged).
        const docV2 = await readBinaryFromMongo(container, id);
        expect(docV2._blobMeta.lastUpdated).toEqual(v1Stamp);
        expect(docV2.contentType).toBe('application/xml');

        // History collection: one snapshot per version, both pinned to the same content stamp,
        // neither carrying inline data.
        const snapshots = await historySnapshotsFor(container, uuid);
        expect(snapshots.map(s => s.meta.versionId)).toEqual(['1', '2']);
        for (const snap of snapshots) {
            expect(snap._blobMeta.lastUpdated).toEqual(v1Stamp);
            expect(snap.data).toBeUndefined();
        }
    });

    test('changed-data update creates a new versioned history object', async () => {
        const request = await createTestRequest(registerMockClients);
        const container = getTestContainer();
        const liveClient = container.base64FieldCloudStorageClient;
        const historyClient = container.historyResourceCloudStorageClient;
        const id = 'binary-change-target';

        await request
            .put(`/4_0_0/Binary/${id}`)
            .send(buildBinary({ id, data: LARGE_DATA }))
            .set(getHeaders())
            .expect(201);
        await drainPostRequest(container);

        const docV1 = await readBinaryFromMongo(container, id);
        const uuid = docV1._uuid;
        const v1Stamp = docV1._blobMeta.lastUpdated;
        expect(historyKeysFor(historyClient, uuid).length).toBe(1);

        await request
            .put(`/4_0_0/Binary/${id}`)
            .send(buildBinary({ id, data: ALT_LARGE_DATA }))
            .set(getHeaders())
            .expect(200);
        await drainPostRequest(container);

        // Two distinct history objects now (one per content, hash-keyed); the live key rotated to
        // the new version's timestamped object holding the new bytes.
        expect(historyKeysFor(historyClient, uuid).length).toBe(2);
        const docV2 = await readBinaryFromMongo(container, id);
        expect(liveClient.uploadedData[liveKeyOf(docV2)]).toBe(ALT_LARGE_DATA);
        expect(docV2._blobMeta.lastUpdated).not.toEqual(v1Stamp);

        // History collection: two snapshots, each pinned to its own content object
        // (distinct lastUpdated stamps), neither carrying inline data.
        const snapshots = await historySnapshotsFor(container, uuid);
        expect(snapshots.map(s => s.meta.versionId)).toEqual(['1', '2']);
        expect(snapshots[0]._blobMeta.lastUpdated).toEqual(v1Stamp);
        expect(snapshots[1]._blobMeta.lastUpdated).toEqual(docV2._blobMeta.lastUpdated);
        expect(snapshots[0]._blobMeta.lastUpdated).not.toEqual(snapshots[1]._blobMeta.lastUpdated);
        for (const snap of snapshots) {
            expect(snap.data).toBeUndefined();
        }
    });

    test('unchanged-data $merge re-uploads when the history object has expired', async () => {
        const request = await createTestRequest(registerMockClients);
        const container = getTestContainer();
        const historyClient = container.historyResourceCloudStorageClient;
        const id = 'binary-expired-target';

        await request
            .put(`/4_0_0/Binary/${id}`)
            .send(buildBinary({ id, data: LARGE_DATA }))
            .set(getHeaders())
            .expect(201);
        await drainPostRequest(container);

        const docV1 = await readBinaryFromMongo(container, id);
        const uuid = docV1._uuid;
        const v1HistoryKey = historyKeysFor(historyClient, uuid)[0];

        // Simulate the 12-month TTL having deleted the history object.
        delete historyClient.uploadedData[v1HistoryKey];
        historyClient.copyCalls = [];

        // Metadata-only $merge (data unchanged) → hash-skip path attempts the copy-onto-self TTL
        // refresh; the source is gone, so it falls back to re-uploading the payload to the same key.
        await request
            .post(`/4_0_0/Binary/$merge`)
            .send({ ...buildBinary({ id, data: LARGE_DATA }), contentType: 'application/xml' })
            .set(getHeaders())
            .expect(200);
        await drainPostRequest(container);

        // Copy was attempted (and failed), so the payload was re-uploaded to the same key.
        expect(historyClient.copyCalls).toContain(v1HistoryKey);
        expect(historyClient.uploadedData[v1HistoryKey]).toBe(LARGE_DATA);
    });

    test('content stamp stays stable across multiple unchanged $merge updates (chain integrity)', async () => {
        const request = await createTestRequest(registerMockClients);
        const container = getTestContainer();
        const historyClient = container.historyResourceCloudStorageClient;
        const id = 'binary-chain-target';

        await request
            .put(`/4_0_0/Binary/${id}`)
            .send(buildBinary({ id, data: LARGE_DATA }))
            .set(getHeaders())
            .expect(201);
        await drainPostRequest(container);

        const docV1 = await readBinaryFromMongo(container, id);
        const uuid = docV1._uuid;
        const v1Stamp = docV1._blobMeta.lastUpdated;

        // $merge keeps the content stamp stable when data is unchanged (hash-skip reuse), so the
        // history chain stays pinned to one object across metadata-only versions.
        for (const contentType of ['application/xml', 'text/plain']) {
            await request
                .post(`/4_0_0/Binary/$merge`)
                .send({ ...buildBinary({ id, data: LARGE_DATA }), contentType })
                .set(getHeaders())
                .expect(200);
            await drainPostRequest(container);
        }

        // Still exactly one history object, stamp never advanced.
        expect(historyKeysFor(historyClient, uuid).length).toBe(1);
        const docFinal = await readBinaryFromMongo(container, id);
        expect(docFinal._blobMeta.lastUpdated).toEqual(v1Stamp);

        // Three history snapshots (v1..v3), all pinned to the same reused history object.
        const snapshots = await historySnapshotsFor(container, uuid);
        expect(snapshots.map(s => s.meta.versionId)).toEqual(['1', '2', '3']);
        for (const snap of snapshots) {
            expect(snap._blobMeta.lastUpdated).toEqual(v1Stamp);
        }
    });

    test('POST create with data above threshold offloads to S3 and returns hydrated resource', async () => {
        const request = await createTestRequest(registerMockClients);
        const container = getTestContainer();
        const liveClient = container.base64FieldCloudStorageClient;

        // POST (unlike PUT) assigns a server-generated UUID as the id.
        const createResp = await request
            .post('/4_0_0/Binary')
            .send(buildBinary({ data: LARGE_DATA }))
            .set(getHeaders())
            .expect(201);

        const createdId = createResp.body.id;

        // Mongo doc is offloaded: no inline data, _blobMeta sidecar present, payload in live bucket.
        const mongoDoc = await readBinaryFromMongo(container, createdId);
        expect(mongoDoc).toBeDefined();
        expect(mongoDoc.data).toBeUndefined();
        expect(mongoDoc._blobMeta).toBeDefined();
        expect(typeof mongoDoc._blobMeta.hash).toBe('string');
        expect(mongoDoc._blobMeta.rawSize).toBe(80);
        const liveKey = liveKeyOf(mongoDoc);
        expect(liveClient.uploadedData[liveKey]).toBe(LARGE_DATA);

        // Response carries the hydrated inline data (asserted directly) and no _blobMeta sidecar.
        expect(createResp.body.data).toBe(LARGE_DATA);
        // Whole-resource verification of the rest of the shape (data swapped for the placeholder
        // on both sides to keep the matcher fast — see DATA_PLACEHOLDER).
        createResp.body.data = DATA_PLACEHOLDER;
        expect(createResp).toHaveResponse(buildExpectedBinary({ id: createdId, data: DATA_PLACEHOLDER }));

        // Cold read on a fresh request scope (stash cleared by drainPostRequest) must hit S3
        // to hydrate — verify the same again and that a download actually ran.
        await drainPostRequest(container);
        const downloadSpy = jest.spyOn(liveClient, 'downloadAsync');
        try {
            const getResp = await request
                .get(`/4_0_0/Binary/${createdId}`)
                .set(getHeaders())
                .expect(200);
            expect(getResp.body.data).toBe(LARGE_DATA);
            getResp.body.data = DATA_PLACEHOLDER;
            expect(getResp).toHaveResponse(buildExpectedBinary({ id: createdId, data: DATA_PLACEHOLDER }));
            expect(downloadSpy).toHaveBeenCalledWith(liveKey);
        } finally {
            downloadSpy.mockRestore();
        }
    });

    // Read-path hydration: every read surface must inline `data` back from the live bucket on a
    // COLD read (a fresh request scope — the seed's request stash is cleared by drainPostRequest —
    // so `data` can only appear if S3 RETRIEVE actually ran). Keys are timestamped (`liveKeyOf`).
    describe('read paths — cold reads hydrate Binary.data from S3', () => {
        test('GET below-threshold Binary returns inline data without touching S3', async () => {
            const request = await createTestRequest(registerMockClients);
            const container = getTestContainer();
            const liveClient = container.base64FieldCloudStorageClient;
            const id = 'binary-read-small';

            await request.put(`/4_0_0/Binary/${id}`).send(buildBinary({ id, data: SMALL_DATA })).set(getHeaders()).expect(201);
            await drainPostRequest(container);

            const downloadSpy = jest.spyOn(liveClient, 'downloadAsync');
            try {
                const getResp = await request.get(`/4_0_0/Binary/${id}`).set(getHeaders()).expect(200);
                expect(getResp.body.data).toBe(SMALL_DATA);
                expect(downloadSpy).not.toHaveBeenCalled();
            } finally {
                downloadSpy.mockRestore();
            }
        });

        test('search bundle (non-streaming) hydrates only the externalized entry', async () => {
            const request = await createTestRequest(registerMockClients);
            const container = getTestContainer();
            const liveClient = container.base64FieldCloudStorageClient;
            const largeId = 'binary-searchbundle-large';
            const smallId = 'binary-searchbundle-small';

            await request.put(`/4_0_0/Binary/${largeId}`).send(buildBinary({ id: largeId, data: LARGE_DATA })).set(getHeaders()).expect(201);
            await drainPostRequest(container);
            await request.put(`/4_0_0/Binary/${smallId}`).send(buildBinary({ id: smallId, data: SMALL_DATA })).set(getHeaders()).expect(201);
            await drainPostRequest(container);

            const largeDoc = await readBinaryFromMongo(container, largeId);

            // Force the non-streaming SearchBundleOperation path (jest defaults to streaming).
            const originalStreamResponse = process.env.STREAM_RESPONSE;
            process.env.STREAM_RESPONSE = '0';
            const downloadSpy = jest.spyOn(liveClient, 'downloadAsync');
            try {
                const searchResp = await request
                    .get(`/4_0_0/Binary?_bundle=1&_count=10&id=${largeId},${smallId}`)
                    .set(getHeaders())
                    .expect(200);
                expect(searchResp.body.resourceType).toBe('Bundle');
                const entries = searchResp.body.entry || [];
                const largeEntry = entries.find(e => e.resource && e.resource.id === largeId);
                const smallEntry = entries.find(e => e.resource && e.resource.id === smallId);
                expect(largeEntry.resource.data).toBe(LARGE_DATA);
                expect(largeEntry.resource._blobMeta).toBeUndefined();
                expect(smallEntry.resource.data).toBe(SMALL_DATA);
                expect(downloadSpy).toHaveBeenCalledTimes(1);
                expect(downloadSpy).toHaveBeenCalledWith(liveKeyOf(largeDoc));
            } finally {
                downloadSpy.mockRestore();
                if (originalStreamResponse === undefined) {
                    delete process.env.STREAM_RESPONSE;
                } else {
                    process.env.STREAM_RESPONSE = originalStreamResponse;
                }
            }
        });

        test('streaming search (NDJSON) hydrates Binary.data via MongoReadableStream', async () => {
            const request = await createTestRequest(registerMockClients);
            const container = getTestContainer();
            const liveClient = container.base64FieldCloudStorageClient;
            const largeId = 'binary-stream-large';
            const smallId = 'binary-stream-small';

            await request.put(`/4_0_0/Binary/${largeId}`).send(buildBinary({ id: largeId, data: LARGE_DATA })).set(getHeaders()).expect(201);
            await drainPostRequest(container);
            await request.put(`/4_0_0/Binary/${smallId}`).send(buildBinary({ id: smallId, data: SMALL_DATA })).set(getHeaders()).expect(201);
            await drainPostRequest(container);

            const largeDoc = await readBinaryFromMongo(container, largeId);

            const downloadSpy = jest.spyOn(liveClient, 'downloadAsync');
            try {
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
                expect(largeEntry.data).toBe(LARGE_DATA);
                expect(largeEntry._blobMeta).toBeUndefined();
                expect(smallEntry.data).toBe(SMALL_DATA);
                expect(downloadSpy).toHaveBeenCalledTimes(1);
                expect(downloadSpy).toHaveBeenCalledWith(liveKeyOf(largeDoc));
            } finally {
                downloadSpy.mockRestore();
            }
        });

        test('GraphQL v1 returns Binary.data hydrated from S3', async () => {
            const request = await createTestRequest(registerMockClients);
            const container = getTestContainer();
            const liveClient = container.base64FieldCloudStorageClient;
            const id = 'binary-graphql-v1';

            await request.put(`/4_0_0/Binary/${id}`).send(buildBinary({ id, data: LARGE_DATA })).set(getHeaders()).expect(201);
            await drainPostRequest(container);
            const mongoDoc = await readBinaryFromMongo(container, id);

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
                expect(entries[0].resource.id).toBe(id);
                expect(entries[0].resource.data).toBe(LARGE_DATA);
                expect(downloadSpy).toHaveBeenCalledWith(liveKeyOf(mongoDoc));
            } finally {
                downloadSpy.mockRestore();
            }
        });

        test('GraphQL v2 returns Binary.data hydrated from S3', async () => {
            const request = await createTestRequest(registerMockClients);
            const container = getTestContainer();
            const liveClient = container.base64FieldCloudStorageClient;
            const id = 'binary-graphql-v2';

            await request.put(`/4_0_0/Binary/${id}`).send(buildBinary({ id, data: LARGE_DATA })).set(getHeaders()).expect(201);
            await drainPostRequest(container);
            const mongoDoc = await readBinaryFromMongo(container, id);

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
                // v2 surfaces _uuid in the id field (consistent with other v2 fixtures).
                expect(entries[0].resource.id).toBe(mongoDoc._uuid);
                expect(entries[0].resource.data).toBe(LARGE_DATA);
                expect(downloadSpy).toHaveBeenCalledWith(liveKeyOf(mongoDoc));
            } finally {
                downloadSpy.mockRestore();
            }
        });

        test('$graph hydrates the Binary start resource from S3', async () => {
            const request = await createTestRequest(registerMockClients);
            const container = getTestContainer();
            const liveClient = container.base64FieldCloudStorageClient;
            const binaryId = 'binary-graph-start';

            await request.put(`/4_0_0/Binary/${binaryId}`).send(buildBinary({ id: binaryId, data: LARGE_DATA })).set(getHeaders()).expect(201);
            await drainPostRequest(container);
            const mongoDoc = await readBinaryFromMongo(container, binaryId);

            const graphDefinition = {
                resourceType: 'GraphDefinition', id: 'binary-only', name: 'binary_only', status: 'active', start: 'Binary'
            };
            const downloadSpy = jest.spyOn(liveClient, 'downloadAsync');
            try {
                const resp = await request
                    .post(`/4_0_0/Binary/$graph?id=${binaryId}&contained=false`)
                    .send(graphDefinition)
                    .set(getHeaders())
                    .expect(200);
                expect(resp.body.resourceType).toBe('Bundle');
                const binaryEntry = (resp.body.entry || []).find(e => e.resource && e.resource.resourceType === 'Binary');
                expect(binaryEntry.resource.id).toBe(binaryId);
                expect(binaryEntry.resource.data).toBe(LARGE_DATA);
                expect(binaryEntry.resource._blobMeta).toBeUndefined();
                expect(downloadSpy).toHaveBeenCalledWith(liveKeyOf(mongoDoc));
            } finally {
                downloadSpy.mockRestore();
            }
        });

        test('$everything hydrates a Binary reachable via DocumentReference in the patient compartment', async () => {
            const request = await createTestRequest(registerMockClients);
            const container = getTestContainer();
            const liveClient = container.base64FieldCloudStorageClient;
            const patientId = 'patient-everything-binary';
            const docRefId = 'docref-everything-binary';
            const binaryId = 'binary-everything-target';

            const baseMeta = {
                source: 'https://test.example.com/source',
                security: [
                    { system: 'https://www.icanbwell.com/owner', code: 'test' },
                    { system: 'https://www.icanbwell.com/access', code: 'test' },
                    { system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'test' }
                ]
            };
            await request.post('/4_0_0/Patient/$merge')
                .send({ resourceType: 'Patient', id: patientId, meta: baseMeta, birthDate: '2000-01-01', gender: 'female' })
                .set(getHeaders()).expect(200);
            await request.post('/4_0_0/DocumentReference/$merge')
                .send({
                    resourceType: 'DocumentReference', id: docRefId, meta: baseMeta, status: 'current',
                    subject: { reference: `Patient/${patientId}` },
                    content: [{ attachment: { contentType: 'application/pdf', url: `Binary/${binaryId}` } }]
                })
                .set(getHeaders()).expect(200);
            await request.put(`/4_0_0/Binary/${binaryId}`).send(buildBinary({ id: binaryId, data: LARGE_DATA })).set(getHeaders()).expect(201);
            await drainPostRequest(container);
            const mongoDoc = await readBinaryFromMongo(container, binaryId);

            const downloadSpy = jest.spyOn(liveClient, 'downloadAsync');
            try {
                const resp = await request.get(`/4_0_0/Patient/${patientId}/$everything`).set(getHeaders()).expect(200);
                expect(resp.body.resourceType).toBe('Bundle');
                const binaryEntry = (resp.body.entry || []).find(e => e.resource && e.resource.resourceType === 'Binary');
                expect(binaryEntry.resource.data).toBe(LARGE_DATA);
                expect(binaryEntry.resource._blobMeta).toBeUndefined();
                expect(downloadSpy).toHaveBeenCalledWith(liveKeyOf(mongoDoc));
            } finally {
                downloadSpy.mockRestore();
            }
        });

        test('cold read returns the resource without data (no 5xx) when the live object is missing', async () => {
            // New behavior (vs the old "fail with 5xx"): RETRIEVE logs the missing object and skips
            // hydration rather than throwing, so a read never surfaces a 500 for a lost payload.
            const request = await createTestRequest(registerMockClients);
            const container = getTestContainer();
            const liveClient = container.base64FieldCloudStorageClient;
            const id = 'binary-cold-read-missing';

            await request.put(`/4_0_0/Binary/${id}`).send(buildBinary({ id, data: LARGE_DATA })).set(getHeaders()).expect(201);
            await drainPostRequest(container);
            const mongoDoc = await readBinaryFromMongo(container, id);

            // The sidecar remains but the live object is gone.
            delete liveClient.uploadedData[liveKeyOf(mongoDoc)];

            const resp = await request.get(`/4_0_0/Binary/${id}`).set(getHeaders()).expect(200);
            expect(resp.body.resourceType).toBe('Binary');
            expect(resp.body.data).toBeUndefined();
            expect(resp.body._blobMeta).toBeUndefined();
        });
    });
});
