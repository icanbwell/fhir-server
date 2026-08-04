const { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } = require('@jest/globals');
const {
    commonBeforeEach, commonAfterEach, createTestRequest, getHeaders, getTestContainer, mockHttpContext
} = require('../../common');
const { MockS3Client } = require('../../export/mocks/s3Client');
const { CLOUD_STORAGE_CLIENTS } = require('../../../constants');

const DATA_A = 'QQ==';
const DATA_B = 'Qg==';
const LIVE_BUCKET = 'test-race-live-bucket';
const HISTORY_BUCKET = 'test-race-history-bucket';

const buildBinary = (data) => ({
    resourceType: 'Binary',
    id: 'binary-aba-race',
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

describe('Timestamp-keyed live bucket: A->B->A never produces a dangling reference', () => {
    let savedEnv;
    beforeAll(() => {
        savedEnv = { ...process.env };
        process.env.BASE64_FIELD_CLOUD_STORAGE_ENABLED = '1';
        process.env.BASE64_FIELD_CLOUD_STORAGE_CLIENT = CLOUD_STORAGE_CLIENTS.S3_CLIENT;
        process.env.RESOURCE_BUCKET_NAME = LIVE_BUCKET;
        process.env.HISTORY_RESOURCE_CLOUD_STORAGE_CLIENT = CLOUD_STORAGE_CLIENTS.S3_CLIENT;
        process.env.HISTORY_RESOURCE_BUCKET_NAME = HISTORY_BUCKET;
        process.env.BASE64_FIELD_DATA_THRESHOLD_KB = '0';
    });
    afterAll(() => { process.env = savedEnv; });

    const registerMockClients = (c) => {
        c.register('base64FieldCloudStorageClient', (cc) => new MockS3Client({
            bucketName: cc.configManager.resourceBucketName, region: cc.configManager.awsRegion
        }));
        c.register('historyResourceCloudStorageClient', (cc) => new MockS3Client({
            bucketName: cc.configManager.historyResourceBucketName, region: cc.configManager.awsRegion
        }));
        return c;
    };

    beforeEach(async () => { await commonBeforeEach(); mockHttpContext(); });
    afterEach(async () => { await commonAfterEach(); });

    const readBinaryFromMongo = async (container) => {
        const db = await container.mongoDatabaseManager.getClientDbAsync();
        return (await db.collection('Binary_4_0_0').find({ id: 'binary-aba-race' }).toArray())[0];
    };

    test('after A->B->A, the live object always matches the currently committed reference', async () => {
        const request = await createTestRequest(registerMockClients);
        const container = getTestContainer();
        const liveClient = container.base64FieldCloudStorageClient;

        await request.put('/4_0_0/Binary/binary-aba-race').send(buildBinary(DATA_A)).set(getHeaders()).expect(201);
        const docA1 = await readBinaryFromMongo(container);
        const keyA1 = `Binary_4_0_0/${docA1._uuid}/${docA1._blobMeta.lastUpdated.getTime()}`;

        await request.put('/4_0_0/Binary/binary-aba-race').send(buildBinary(DATA_B)).set(getHeaders()).expect(200);
        // A's FIRST key is now superseded and should be cleaned up — unconditionally, no Mongo read.
        expect(liveClient.uploadedData[keyA1]).toBeUndefined();

        await request.put('/4_0_0/Binary/binary-aba-race').send(buildBinary(DATA_A)).set(getHeaders()).expect(200);
        const docA2 = await readBinaryFromMongo(container);
        const keyA2 = `Binary_4_0_0/${docA2._uuid}/${docA2._blobMeta.lastUpdated.getTime()}`;

        // Second "A" got a DIFFERENT (new) key than the first — never resurrects the deleted one.
        expect(keyA2).not.toBe(keyA1);
        expect(liveClient.uploadedData[keyA2]).toBe(DATA_A);

        // The Mongo doc's committed live key must always be present and correct.
        expect(liveClient.uploadedData[
            `Binary_4_0_0/${docA2._uuid}/${docA2._blobMeta.lastUpdated.getTime()}`
        ]).toBe(DATA_A);
    });
});
