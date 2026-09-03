const { describe, beforeAll, afterAll, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');

const { commonBeforeEach, commonAfterEach, createTestRequest, getHeaders, getTestContainer } = require('../../common');
const {
    MigrateBinaryDataToCloudStorageRunner
} = require('../../../../admin/runners/migrateBinaryDataToCloudStorageRunner');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { MockS3Client } = require('../../export/mocks/s3Client');
const { CLOUD_STORAGE_CLIENTS } = require('../../../../constants');

const SMALL_DATA = 'B'.repeat(1024);
const LARGE_DATA = 'A'.repeat(80 * 1024);

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

describe('MigrateBinaryDataToCloudStorageRunner end-to-end', () => {
    let savedEnv;

    beforeAll(() => {
        savedEnv = {
            BASE64_FIELD_CLOUD_STORAGE_ENABLED: process.env.BASE64_FIELD_CLOUD_STORAGE_ENABLED,
            BASE64_FIELD_CLOUD_STORAGE_CLIENT: process.env.BASE64_FIELD_CLOUD_STORAGE_CLIENT,
            RESOURCE_BUCKET_NAME: process.env.RESOURCE_BUCKET_NAME,
            HISTORY_RESOURCE_CLOUD_STORAGE_CLIENT: process.env.HISTORY_RESOURCE_CLOUD_STORAGE_CLIENT,
            HISTORY_RESOURCE_BUCKET_NAME: process.env.HISTORY_RESOURCE_BUCKET_NAME
        };
        process.env.BASE64_FIELD_CLOUD_STORAGE_ENABLED = '1';
        process.env.BASE64_FIELD_CLOUD_STORAGE_CLIENT = CLOUD_STORAGE_CLIENTS.S3_CLIENT;
        process.env.RESOURCE_BUCKET_NAME = 'test-live-bucket';
        process.env.HISTORY_RESOURCE_CLOUD_STORAGE_CLIENT = CLOUD_STORAGE_CLIENTS.S3_CLIENT;
        process.env.HISTORY_RESOURCE_BUCKET_NAME = 'test-history-bucket';
    });

    afterAll(() => {
        for (const [key, value] of Object.entries(savedEnv)) {
            if (value === undefined) { delete process.env[key]; } else { process.env[key] = value; }
        }
    });

    const registerMockClient = (c) => {
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

    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('migrates a pre-existing large inline Binary and the API hydrates it back from S3', async () => {
        const request = await createTestRequest(registerMockClient);
        const container = getTestContainer();
        const liveClient = container.base64FieldCloudStorageClient;
        const id = 'binary-legacy-migration-target';

        await request
            .put(`/4_0_0/Binary/${id}`)
            .send(buildBinary({ id, data: SMALL_DATA }))
            .set(getHeaders())
            .expect(201);

        const db = await container.mongoDatabaseManager.getClientDbAsync();
        const collection = db.collection('Binary_4_0_0');
        const seeded = await collection.findOne({ id });
        expect(seeded).toBeDefined();
        expect(seeded._blobMeta).toBeUndefined();

        await collection.updateOne({ _id: seeded._id }, { $set: { data: LARGE_DATA } });
        const beforeMigration = await collection.findOne({ _id: seeded._id });
        expect(beforeMigration.data).toBe(LARGE_DATA);
        expect(beforeMigration._blobMeta).toBeUndefined();
        expect(Object.keys(liveClient.uploadedData)).toHaveLength(0);

        const runner = new MigrateBinaryDataToCloudStorageRunner({
            mongoDatabaseManager: container.mongoDatabaseManager,
            adminLogger: new AdminLogger(),
            batchSize: 10,
            concurrency: 2,
            thresholdKB: 1,
            startId: undefined,
            count: undefined,
            fromDate: undefined,
            toDate: undefined,
            dryRun: false,
            base64FieldCloudStorageClient: liveClient,
            configManager: container.configManager
        });
        await runner.processAsync();

        expect(runner.documentsMigrated).toBe(1);

        const migrated = await collection.findOne({ _id: seeded._id });
        expect(migrated.data).toBeUndefined();
        expect(migrated._blobMeta).toBeDefined();
        expect(migrated._blobMeta.rawSize).toBe(Math.ceil(Buffer.byteLength(LARGE_DATA, 'utf8') / 1024));

        const liveKey = runner._buildLiveKey(migrated._uuid, migrated._blobMeta.lastUpdated.getTime());
        expect(liveClient.uploadedData[liveKey]).toBe(LARGE_DATA);

        const downloadSpy = jest.spyOn(liveClient, 'downloadAsync');
        try {
            const getResp = await request
                .get(`/4_0_0/Binary/${id}`)
                .set(getHeaders())
                .expect(200);

            expect(getResp.body.data).toBe(LARGE_DATA);
            expect(downloadSpy).toHaveBeenCalledWith(liveKey);
        } finally {
            downloadSpy.mockRestore();
        }
    });
});
