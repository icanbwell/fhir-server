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
            if (liveClient) { liveClient.uploadedData = {}; liveClient.etags = {}; liveClient.copyCalls = []; }
            if (historyClient) { historyClient.uploadedData = {}; historyClient.etags = {}; historyClient.copyCalls = []; }
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

        // History Mongo snapshot keeps the deterministic rawReference; the version
        // discriminator lives in `_blobMeta.lastUpdated`. The history bucket key is
        // `{rawReference}/{epoch(lastUpdated)}` (asserted above via versionedKeys).
        const historyDocs = await readBinaryHistoryFromMongo(container);
        const matchedSnapshots = historyDocs.filter(d => d.resource && d.resource._uuid === mongoDocAfterCreate._uuid);
        expect(matchedSnapshots.length).toBeGreaterThan(0);
        for (const entry of matchedSnapshots) {
            if (entry.resource._blobMeta) {
                expect(entry.resource._blobMeta.rawReference).toBe(mongoDocAfterCreate._uuid);
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

    test('reuploadChangedToLiveAsync re-PUTs changed content and no-ops without a cached change', async () => {
        await createTestRequest(registerMockClients);
        const container = getTestContainer();
        const b64 = container.base64DataManager;
        const liveClient = container.base64FieldCloudStorageClient;
        const requestInfo = getTestRequestInfo({ requestId: 'reupload-mechanism' });
        const uuid = '11111111-1111-1111-1111-111111111111';

        // Externalize a Binary through INSERT: uploads to live + stashes { content, changed:true }.
        const resource = {
            resourceType: 'Binary',
            id: 'ru',
            _uuid: uuid,
            meta: { lastUpdated: '2026-07-08T00:00:00.000Z' },
            contentType: 'application/pdf',
            data: LARGE_DATA
        };
        await b64.transformAsync(resource, BLOB_OP.INSERT, requestInfo);
        const liveKey = `Binary_4_0_0/${uuid}`;
        expect(liveClient.uploadedData[liveKey]).toBe(LARGE_DATA);

        // A competitor clobbered the live object; re-upload must re-establish our bytes.
        liveClient.uploadedData[liveKey] = 'competitor-bytes';
        await b64.reuploadChangedToLiveAsync(resource, requestInfo);
        expect(liveClient.uploadedData[liveKey]).toBe(LARGE_DATA);

        // No cached change for a different uuid => no-op (nothing uploaded).
        liveClient.uploadedData = {};
        const other = {
            resourceType: 'Binary',
            _uuid: '22222222-2222-2222-2222-222222222222',
            _blobMeta: { rawReference: '22222222-2222-2222-2222-222222222222' }
        };
        await b64.reuploadChangedToLiveAsync(other, requestInfo);
        expect(Object.keys(liveClient.uploadedData).length).toBe(0);
    });

    // Externalize a "previous version" then a "changed write" for the same uuid under one
    // request, returning the live key. After this the live bucket holds the NEW bytes and the
    // request stashes { currentData: PREV, originalData: { NEW, etag } }.
    const setUpChangedWrite = async (b64, requestInfo, uuid, prev, next) => {
        const res = {
            resourceType: 'Binary', id: 'rv', _uuid: uuid,
            meta: { lastUpdated: '2026-07-08T00:00:00.000Z' }, contentType: 'application/pdf', data: prev
        };
        await b64.transformAsync(res, BLOB_OP.INSERT, requestInfo);   // externalize prev: live = PREV
        await b64.transformAsync(res, BLOB_OP.RETRIEVE, requestInfo); // stash currentData = PREV
        res.data = next;
        await b64.transformAsync(res, BLOB_OP.INSERT, requestInfo);   // changed write: live = NEW
        return { res, liveKey: `Binary_4_0_0/${uuid}` };
    };

    test('revertLiveAsync restores previous bytes when the live object is still ours (ETag matches)', async () => {
        await createTestRequest(registerMockClients);
        const container = getTestContainer();
        const b64 = container.base64DataManager;
        const liveClient = container.base64FieldCloudStorageClient;
        const PREV = 'P'.repeat(80 * 1024);
        const NEW = 'N'.repeat(80 * 1024);

        const R = getTestRequestInfo({ requestId: 'revert-restore' });
        const U = '33333333-3333-3333-3333-333333333333';
        const { res, liveKey } = await setUpChangedWrite(b64, R, U, PREV, NEW);
        expect(liveClient.uploadedData[liveKey]).toBe(NEW);

        // No competitor touched the object → If-Match succeeds → previous bytes restored.
        await b64.revertLiveAsync(res, R);
        expect(liveClient.uploadedData[liveKey]).toBe(PREV);
    });

    test('revertLiveAsync leaves live intact when a competitor overwrote the object (ETag mismatch)', async () => {
        await createTestRequest(registerMockClients);
        const container = getTestContainer();
        const b64 = container.base64DataManager;
        const liveClient = container.base64FieldCloudStorageClient;
        const PREV = 'P'.repeat(80 * 1024);
        const NEW = 'N'.repeat(80 * 1024);
        const COMPETITOR = 'K'.repeat(80 * 1024);

        const R = getTestRequestInfo({ requestId: 'revert-skip' });
        const U = '55555555-5555-5555-5555-555555555555';
        const { res, liveKey } = await setUpChangedWrite(b64, R, U, PREV, NEW);

        // A competitor commits & overwrites the live object (bumps its ETag) after our write.
        await liveClient.uploadAsync({ filePath: liveKey, data: Buffer.from(COMPETITOR, 'utf8') });
        expect(liveClient.uploadedData[liveKey]).toBe(COMPETITOR);

        await b64.revertLiveAsync(res, R);
        // If-Match on our stale ETag fails → no clobber of the winner's committed bytes.
        expect(liveClient.uploadedData[liveKey]).toBe(COMPETITOR);
    });

    test('revertLiveAsync leaves the live object in place on a failed create (orphan is harmless)', async () => {
        await createTestRequest(registerMockClients);
        const container = getTestContainer();
        const b64 = container.base64DataManager;
        const liveClient = container.base64FieldCloudStorageClient;
        const NEW = 'N'.repeat(80 * 1024);

        const R = getTestRequestInfo({ requestId: 'revert-create-noop' });
        const U = '66666666-6666-6666-6666-666666666666';
        const liveKey = `Binary_4_0_0/${U}`;
        const res = {
            resourceType: 'Binary', id: 'rv', _uuid: U,
            meta: { lastUpdated: '2026-07-08T00:00:00.000Z' }, contentType: 'application/pdf', data: NEW
        };
        await b64.transformAsync(res, BLOB_OP.INSERT, R);   // create: live = NEW, no prior content
        expect(liveClient.uploadedData[liveKey]).toBe(NEW);

        // No previous version to restore → revert is a no-op; the unreferenced orphan is left as-is
        // (it will be overwritten by any future write to the same deterministic key).
        await b64.revertLiveAsync(res, R);
        expect(liveClient.uploadedData[liveKey]).toBe(NEW);
    });

    test('retry replaceOneAsync re-uploads the changed payload before committing', async () => {
        const request = await createTestRequest(registerMockClients);
        const container = getTestContainer();
        const b64 = container.base64DataManager;
        const liveClient = container.base64FieldCloudStorageClient;
        const id = 'binary-retry-reupload';

        // Seed v1 with LARGE_DATA.
        await request
            .put(`/4_0_0/Binary/${id}`)
            .send(buildBinary({ id, data: LARGE_DATA }))
            .set(getHeaders())
            .expect(201);
        await drainPostRequest(container);

        const dbDoc = await readBinaryFromMongo(container, id);
        const uuid = dbDoc._uuid;
        const liveKey = `Binary_4_0_0/${uuid}`;

        // Build the retry input: the current externalized doc with a changed payload, run
        // through INSERT under a controlled requestInfo so its bytes are cached (changed:true).
        const requestInfo = getTestRequestInfo({ requestId: 'retry-reupload-req' });
        const incoming = { ...dbDoc, data: ALT_LARGE_DATA, contentType: 'application/xml' };
        delete incoming._id;
        await b64.transformAsync(incoming, BLOB_OP.INSERT, requestInfo);

        // Simulate a concurrent writer clobbering the live object with different bytes.
        liveClient.uploadedData[liveKey] = LARGE_DATA;

        // Drive the fallback retry path directly; it must re-upload our payload before the write.
        const updateManager = container.databaseUpdateFactory.createFastDatabaseUpdateManager({
            resourceType: 'Binary',
            base_version: '4_0_0'
        });
        await updateManager.replaceOneAsync({ base_version: '4_0_0', requestInfo, doc: incoming });

        expect(liveClient.uploadedData[liveKey]).toBe(ALT_LARGE_DATA);
    });

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
        const liveKey = `Binary_4_0_0/${dbDoc._uuid}`;
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
        expect(savedResource._blobMeta.rawReference).toBe(dbDoc._uuid);
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
        const uuid = dbDoc._uuid;
        const liveKey = `Binary_4_0_0/${uuid}`;

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
        expect(savedResource._blobMeta.rawReference).toBe(uuid);
        expect(liveClient.uploadedData[liveKey]).toBe(ALT_LARGE_DATA);

        const finalDoc = await readBinaryFromMongo(container, id);
        expect(finalDoc.meta.versionId).toBe('2');
        expect(finalDoc._blobMeta).toBeDefined();
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
        const uuid = dbDoc._uuid;
        const liveKey = `Binary_4_0_0/${uuid}`;

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
        expect(savedResource._blobMeta.rawReference).toBe(uuid);
        expect(liveClient.uploadedData[liveKey]).toBe(ALT_LARGE_DATA);

        const finalDoc = await readBinaryFromMongo(container, id);
        expect(finalDoc.meta.versionId).toBe('2');
        expect(finalDoc._blobMeta).toBeDefined();
    });

    test('unchanged-data update reuses the history object and refreshes its TTL', async () => {
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
        expect(docV1._blobMeta.rawReference).toBe(uuid);
        const v1Stamp = docV1._blobMeta.lastUpdated;
        expect(v1Stamp).toBeDefined();
        // Stored as a BSON Date in Mongo, matching meta.lastUpdated.
        expect(v1Stamp).toBeInstanceOf(Date);
        const histKeysV1 = historyKeysFor(historyClient, uuid);
        expect(histKeysV1.length).toBe(1);
        const v1HistoryKey = histKeysV1[0];
        historyClient.copyCalls = [];

        // Metadata-only update: same payload, different contentType => version bump, data unchanged.
        await request
            .put(`/4_0_0/Binary/${id}`)
            .send({ ...buildBinary({ id, data: LARGE_DATA }), contentType: 'application/xml' })
            .set(getHeaders())
            .expect(200);
        await drainPostRequest(container);

        // No NEW history object; the existing one had its TTL refreshed via copy-onto-self.
        expect(historyKeysFor(historyClient, uuid)).toEqual(histKeysV1);
        expect(historyClient.copyCalls).toContain(v1HistoryKey);

        // Current doc carried the same content stamp forward (chain discriminator unchanged).
        const docV2 = await readBinaryFromMongo(container, id);
        expect(docV2._blobMeta.lastUpdated).toEqual(v1Stamp);
        expect(docV2._blobMeta.rawReference).toBe(uuid);
        expect(docV2.contentType).toBe('application/xml');

        // History collection: one snapshot per version, both referencing the same reused
        // history object (same rawReference + lastUpdated), neither carrying inline data.
        const snapshots = await historySnapshotsFor(container, uuid);
        expect(snapshots.map(s => s.meta.versionId)).toEqual(['1', '2']);
        for (const snap of snapshots) {
            expect(snap._blobMeta.rawReference).toBe(uuid);
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

        // Two distinct history objects now (one per content), live overwritten with new bytes.
        expect(historyKeysFor(historyClient, uuid).length).toBe(2);
        expect(liveClient.uploadedData[`Binary_4_0_0/${uuid}`]).toBe(ALT_LARGE_DATA);

        const docV2 = await readBinaryFromMongo(container, id);
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

    test('unchanged-data update re-uploads when the history object has expired', async () => {
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

        await request
            .put(`/4_0_0/Binary/${id}`)
            .send({ ...buildBinary({ id, data: LARGE_DATA }), contentType: 'application/xml' })
            .set(getHeaders())
            .expect(200);
        await drainPostRequest(container);

        // Copy was attempted (and failed), so the payload was re-uploaded to the same key.
        expect(historyClient.copyCalls).toContain(v1HistoryKey);
        expect(historyClient.uploadedData[v1HistoryKey]).toBe(LARGE_DATA);
    });

    test('content stamp stays stable across multiple unchanged updates (chain integrity)', async () => {
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

        for (const contentType of ['application/xml', 'text/plain']) {
            await request
                .put(`/4_0_0/Binary/${id}`)
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
            expect(snap._blobMeta.rawReference).toBe(uuid);
        }
    });
});
