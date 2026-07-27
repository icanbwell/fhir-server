const { afterAll, afterEach, beforeAll, beforeEach, describe, expect, jest, test } = require('@jest/globals');
const {
    commonBeforeEach, commonAfterEach, createTestRequest, getHeaders, getTestContainer,
    mockHttpContext
} = require('../../common');
const { MockS3Client } = require('../../export/mocks/s3Client');
const { CLOUD_STORAGE_CLIENTS } = require('../../../constants');

const LIVE_BUCKET = 'test-binary-delete-live-bucket';
const HISTORY_BUCKET = 'test-binary-delete-history-bucket';
const LARGE_DATA = 'A'.repeat(80 * 1024); // 80 KB — exceeds the 64 KB default threshold
const SMALL_DATA = 'B'.repeat(1024); // 1 KB — stays inline

const buildBinary = (id, data) => ({
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

describe('Binary delete — S3 history persistence', () => {
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
            if (value === undefined) { delete process.env[key]; } else { process.env[key] = value; }
        }
    });

    const registerMockClients = (c) => {
        c.register('base64FieldCloudStorageClient', (cc) => new MockS3Client({
            bucketName: cc.configManager.resourceBucketName, region: cc.configManager.awsRegion
        }));
        c.register('historyResourceCloudStorageClient', (cc) => new MockS3Client({
            bucketName: cc.configManager.historyResourceBucketName, region: cc.configManager.awsRegion
        }));
        return c;
    };

    let requestId;
    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
        // The container (and therefore the MockS3Client instances) is cached across tests in this
        // file — reset the in-memory uploadedData maps so each test starts with empty buckets.
        const container = getTestContainer();
        if (container) {
            const liveClient = container.base64FieldCloudStorageClient;
            const historyClient = container.historyResourceCloudStorageClient;
            if (liveClient) { liveClient.uploadedData = {}; liveClient.copyCalls = []; }
            if (historyClient) { historyClient.uploadedData = {}; historyClient.copyCalls = []; }
        }
    });
    afterEach(async () => { await commonAfterEach(); jest.clearAllMocks(); });

    /**
     * Drain the post-request processor before issuing a second write in the same test.
     * `mockHttpContext` fixes one requestId for every request in the test, so a PUT's own
     * deferred history-write task and a subsequent DELETE's synchronous history write would
     * otherwise share one request-scoped bulk-insert queue and collide (same hazard documented
     * in blobStorage.test.js's own `drainPostRequest` helper).
     */
    const drainPostRequest = async (container) => {
        await container.postRequestProcessor.waitTillDoneAsync({ requestId, timeoutInSeconds: 20 });
    };

    const readBinaryFromMongo = async (container, id) => {
        const db = await container.mongoDatabaseManager.getClientDbAsync();
        return (await db.collection('Binary_4_0_0').find({ id }).toArray())[0];
    };

    const readBinaryHistoryFromMongo = async (container) => {
        const historyDb = await container.mongoDatabaseManager.getResourceHistoryDbAsync();
        return historyDb.collection('Binary_4_0_0_History').find({}).toArray();
    };

    const liveKeyOf = (doc) => `Binary_4_0_0/${doc._uuid}/${doc._blobMeta.lastUpdated.getTime()}`;
    const historyKeyOf = (doc) => `Binary_4_0_0/${doc._uuid}/${doc._blobMeta.hash}`;

    test('REST DELETE of an externalized Binary persists its data to the history bucket and cleans up the live object', async () => {
        const request = await createTestRequest(registerMockClients);
        const container = getTestContainer();
        const liveClient = container.base64FieldCloudStorageClient;
        const historyClient = container.historyResourceCloudStorageClient;
        const id = 'binary-delete-externalized';

        await request.put(`/4_0_0/Binary/${id}`).send(buildBinary(id, LARGE_DATA)).set(getHeaders()).expect(201);
        await drainPostRequest(container);
        const doc = await readBinaryFromMongo(container, id);
        expect(liveClient.uploadedData[liveKeyOf(doc)]).toBe(LARGE_DATA);

        await request.delete(`/4_0_0/Binary/${id}`).set(getHeaders()).expect(204);

        expect(await readBinaryFromMongo(container, id)).toBeUndefined();
        expect(historyClient.uploadedData[historyKeyOf(doc)]).toBe(LARGE_DATA);
        expect(liveClient.uploadedData[liveKeyOf(doc)]).toBeUndefined();

        const historyDocs = await readBinaryHistoryFromMongo(container);
        const deleteHistoryEntry = historyDocs.find((h) => h.request && h.request.method === 'DELETE');
        expect(deleteHistoryEntry).toBeDefined();
        expect(deleteHistoryEntry.resource.data).toBeUndefined();
        expect(deleteHistoryEntry.resource._blobMeta.hash).toBe(doc._blobMeta.hash);
    });

    test('REST DELETE of a never-externalized (small) Binary is unchanged: no S3 traffic', async () => {
        const request = await createTestRequest(registerMockClients);
        const container = getTestContainer();
        const liveClient = container.base64FieldCloudStorageClient;
        const historyClient = container.historyResourceCloudStorageClient;
        const id = 'binary-delete-small';

        await request.put(`/4_0_0/Binary/${id}`).send(buildBinary(id, SMALL_DATA)).set(getHeaders()).expect(201);
        await drainPostRequest(container);
        await request.delete(`/4_0_0/Binary/${id}`).set(getHeaders()).expect(204);

        expect(await readBinaryFromMongo(container, id)).toBeUndefined();
        expect(Object.keys(liveClient.uploadedData)).toHaveLength(0);
        expect(Object.keys(historyClient.uploadedData)).toHaveLength(0);

        const historyDocs = await readBinaryHistoryFromMongo(container);
        const deleteHistoryEntry = historyDocs.find((h) => h.request && h.request.method === 'DELETE');
        expect(deleteHistoryEntry.resource.data).toBe(SMALL_DATA);
    });

    test('$graph DELETE on Binary as the root resource strips pre-hydrated data before writing history, and cleans up the live object after commit', async () => {
        const request = await createTestRequest(registerMockClients);
        const container = getTestContainer();
        const liveClient = container.base64FieldCloudStorageClient;
        const historyClient = container.historyResourceCloudStorageClient;
        const id = 'binary-delete-graph-prehydrated';

        await request.put(`/4_0_0/Binary/${id}`).send(buildBinary(id, LARGE_DATA)).set(getHeaders()).expect(201);
        await drainPostRequest(container);
        const doc = await readBinaryFromMongo(container, id);
        expect(liveClient.uploadedData[liveKeyOf(doc)]).toBe(LARGE_DATA);

        const graphDefinition = {
            resourceType: 'GraphDefinition', name: 'binary_only', status: 'active', start: 'Binary'
        };
        await request
            .delete(`/4_0_0/Binary/${id}/$graph`)
            .set(getHeaders())
            .send(graphDefinition)
            .expect(200);

        expect(await readBinaryFromMongo(container, id)).toBeUndefined();
        expect(historyClient.uploadedData[historyKeyOf(doc)]).toBe(LARGE_DATA);
        expect(liveClient.uploadedData[liveKeyOf(doc)]).toBeUndefined();

        const historyDocs = await readBinaryHistoryFromMongo(container);
        const deleteHistoryEntry = historyDocs.find((h) => h.request && h.request.method === 'DELETE');
        expect(deleteHistoryEntry).toBeDefined();
        expect(deleteHistoryEntry.resource.data).toBeUndefined();
    });

    test('a failed history persist aborts the delete: the resource is NOT removed from Mongo', async () => {
        const request = await createTestRequest(registerMockClients);
        const container = getTestContainer();
        const historyClient = container.historyResourceCloudStorageClient;
        const id = 'binary-delete-failure';

        await request.put(`/4_0_0/Binary/${id}`).send(buildBinary(id, LARGE_DATA)).set(getHeaders()).expect(201);
        await drainPostRequest(container);

        jest.spyOn(historyClient, 'copyObjectAsync').mockRejectedValue(new Error('S3 outage'));
        await request.delete(`/4_0_0/Binary/${id}`).set(getHeaders()).expect(500);

        expect(await readBinaryFromMongo(container, id)).toBeDefined();
    });
});
