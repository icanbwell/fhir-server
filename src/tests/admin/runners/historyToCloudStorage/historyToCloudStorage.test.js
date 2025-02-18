const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');
const env = require('var');

const utils = require('../../../../utils/uid.util');
let i = 5;
// need to be above other imports
jest.spyOn(utils, 'generateUUID').mockImplementation(() => {
    i = i + 1;
    return `randomUUID-${i}`;
});

const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getTestContainer
} = require('../../../common');

const { MockS3Client } = require('../../../export/mocks/s3Client');

// test file
const binaryHistoryData = require('./fixtures/binary/binaryHistoryData.json');

// expected
const expectedHistoryDataAfterUpdate = require('./fixtures/expected/expectedHistoryDataAfterUpdate.json');
const expectedDataUploadedToCloudStorage = require('./fixtures/expected/expectedDataUploadedToCloudStorage.json');
const { CLOUD_STORAGE_CLIENTS } = require('../../../../constants');
const {
    MigrateHistoryToCloudStorageRunner
} = require('../../../../admin/runners/migrateHistoryToCloudStorageRunner');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { ObjectId } = require('mongodb');
const { CloudStorageClient } = require('../../../../utils/cloudStorageClient');

describe('Binary history resource should be migrated to S3', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
        jest.clearAllMocks();
    });

    test('Binary history resource should be migrated to S3 and already updated or old format resource should be skipped', async () => {
        let historyResourceCloudStorageBucket = env.HISTORY_RESOURCE_BUCKET_NAME;
        let historyResourceCloudStorageClientEnv = env.HISTORY_RESOURCE_CLOUD_STORAGE_CLIENT;
        env.HISTORY_RESOURCE_BUCKET_NAME = 'test';
        env.HISTORY_RESOURCE_CLOUD_STORAGE_CLIENT = CLOUD_STORAGE_CLIENTS.S3_CLIENT;

        const adminLogger = new AdminLogger();

        await createTestRequest((c) => {
            c.register('historyResourceCloudStorageClient', (c) => {
                if (
                    c.configManager.historyResourceCloudStorageClient ===
                    CLOUD_STORAGE_CLIENTS.S3_CLIENT
                ) {
                    return new MockS3Client({
                        bucketName: c.configManager.historyResourceBucketName,
                        region: c.configManager.awsRegion
                    });
                }
                return null;
            });
            c.register(
                'migrateHistoryToCloudStorageRunner',
                (c) =>
                    new MigrateHistoryToCloudStorageRunner({
                        mongoCollectionManager: c.mongoCollectionManager,
                        mongoDatabaseManager: c.mongoDatabaseManager,
                        collectionName: 'Binary_4_0_0_History',
                        batchSize: 2,
                        adminLogger,
                        limit: undefined,
                        startAfterId: ObjectId.createFromTime('10').toString(),
                        historyResourceCloudStorageClient: c.historyResourceCloudStorageClient,
                        configManager: c.configManager
                    })
            );
            return c;
        });
        const container = getTestContainer();

        /**
         * @type {CloudStorageClient}
        */
        const historyResourceCloudStorageClient = container.historyResourceCloudStorageClient;

        const mockUploadAsync = jest.spyOn(
            historyResourceCloudStorageClient,
            'uploadAsync'
        );

        /**
         * @type {HistoryTestMongoDatabaseManager}
         */
        const mongoDatabaseManager = container.mongoDatabaseManager;
        /**
         * mongo fhirDb connection
         * @type {import('mongodb').Db}
         */
        const resourceHistoryDb = await mongoDatabaseManager.getResourceHistoryDbAsync();
        const binaryHistoryCollection = resourceHistoryDb.collection('Binary_4_0_0_History');
        // this also updates the _id in data (binaryHistoryData) that is used for comparision further
        await binaryHistoryCollection.insertMany(
            binaryHistoryData.map((item) => {
                item._id = ObjectId.createFromTime(item._id);
                return item;
            })
        );

        // verify data in db before updating
        let binaryHistoryEntries = await binaryHistoryCollection.find({}).toArray();
        expect(binaryHistoryEntries).toEqual(binaryHistoryData);

        const migrateHistoryToCloudStorageRunner = container.migrateHistoryToCloudStorageRunner;
        await migrateHistoryToCloudStorageRunner.processAsync();

        expectedHistoryDataAfterUpdate.map((item) => {
            item._id = ObjectId.createFromTime(item._id);
            return item;
        });
        // verify data in db after updating
        binaryHistoryEntries = await binaryHistoryCollection.find({}).toArray();
        expect(binaryHistoryEntries).toEqual(expectedHistoryDataAfterUpdate);

        // _id 10 is skipped by startAfterId
        // _id 11 is already updated
        // _id 19 is skipped due to old format
        expect(mockUploadAsync).toHaveBeenCalledTimes(7);

        let filePaths = expectedHistoryDataAfterUpdate.map((item) => `Binary_4_0_0_History/${item?.resource?._uuid}/${item._ref}.json`)
        const cloudStorageData = historyResourceCloudStorageClient.downloadInBatchAsync({filePaths, batch: 100});
        Object.keys(cloudStorageData).forEach(key => {
            cloudStorageData[key] = JSON.parse(cloudStorageData[key]);
        });
        expect(cloudStorageData).toEqual(expectedDataUploadedToCloudStorage)

        env.HISTORY_RESOURCE_BUCKET_NAME = historyResourceCloudStorageBucket;
        env.HISTORY_RESOURCE_CLOUD_STORAGE_CLIENT = historyResourceCloudStorageClientEnv;
    });
});
