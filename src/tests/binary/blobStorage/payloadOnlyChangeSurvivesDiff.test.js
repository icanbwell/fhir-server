const { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } = require('@jest/globals');
const {
    commonBeforeEach, commonAfterEach, createTestRequest, getHeaders, getTestContainer, mockHttpContext
} = require('../../common');
const { MockS3Client } = require('../../export/mocks/s3Client');
const { CLOUD_STORAGE_CLIENTS } = require('../../../constants');

const DATA_X = 'WFhY';
const DATA_Y = 'WVla';
const LIVE_BUCKET = 'test-diff-live-bucket';
const HISTORY_BUCKET = 'test-diff-history-bucket';

const buildBinary = (data) => ({
    resourceType: 'Binary',
    id: 'binary-payload-only-change',
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

describe('Payload-only change survives the (unmodified) generic diff', () => {
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

    test('changing only the externalized data bumps the version and re-externalizes new content', async () => {
        const request = await createTestRequest(registerMockClients);
        const container = getTestContainer();

        await request.put('/4_0_0/Binary/binary-payload-only-change').send(buildBinary(DATA_X)).set(getHeaders()).expect(201);
        const putResp = await request.put('/4_0_0/Binary/binary-payload-only-change').send(buildBinary(DATA_Y)).set(getHeaders()).expect(200);

        expect(putResp.body.meta.versionId).toBe('2');
        expect(putResp.body.data).toBe(DATA_Y);

        const db = await container.mongoDatabaseManager.getClientDbAsync();
        const doc = (await db.collection('Binary_4_0_0').find({ id: 'binary-payload-only-change' }).toArray())[0];
        expect(doc.data).toBeUndefined();
        expect(doc._blobMeta).toBeDefined();
        const liveKey = `Binary_4_0_0/${doc._uuid}/${doc._blobMeta.lastUpdated.getTime()}`;
        expect(container.base64FieldCloudStorageClient.uploadedData[liveKey]).toBe(DATA_Y);
    });

    test('re-PUTting identical content is a true no-op (no version bump)', async () => {
        const request = await createTestRequest(registerMockClients);
        const container = getTestContainer();

        await request.put('/4_0_0/Binary/binary-payload-only-change').send(buildBinary(DATA_X)).set(getHeaders()).expect(201);
        const secondResp = await request.put('/4_0_0/Binary/binary-payload-only-change').send(buildBinary(DATA_X)).set(getHeaders());

        const db = await container.mongoDatabaseManager.getClientDbAsync();
        const doc = (await db.collection('Binary_4_0_0').find({ id: 'binary-payload-only-change' }).toArray())[0];
        expect(doc.meta.versionId).toBe('1');
        expect(secondResp.status).toBeLessThan(300);
    });
});
