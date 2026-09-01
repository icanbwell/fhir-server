const {
    describe,
    beforeEach,
    afterEach,
    test,
    expect,
    beforeAll,
    afterAll,
    jest
} = require('@jest/globals');

const utils = require('../../../../utils/uid.util');
let i = 0;
// need to be above other imports
jest.spyOn(utils, 'generateUUID').mockImplementation(() => {
    i = i + 1;
    return `randomUUID-${i}`;
});

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer,
    mockHttpContext
} = require('../../common');

const { MockS3Client } = require('../../export/mocks/s3Client');

// test file
const binaryResources = require('./fixtures/binary/binary.json');

// expected
const expectedBinaryHistory = require('./fixtures/expected/expectedBinaryHistory.json');
const expectedBinaryHistoryWithS3Path = require('./fixtures/expected/expectedBinaryHistoryWithS3Path.json');
const expectedBinaryHistoryS3Data = require('./fixtures/expected/expectedBinaryHistoryS3Data.json');
const expectedPartialHistoryData = require('./fixtures/expected/expected_partial_history.json');
const expectedPartialHistoryByIdData = require('./fixtures/expected/expected_partial_history_by_id.json');
const expectedPartialHistoryByVersionIdData = require('./fixtures/expected/expected_partial_history_by_version_id.json');
const expectedHistoryData = require('./fixtures/expected/expected_history.json');
const expectedHistoryByIdData = require('./fixtures/expected/expected_history_by_id.json');
const expectedHistoryByVersionIdData = require('./fixtures/expected/expected_history_by_version_id.json');
const { CLOUD_STORAGE_CLIENTS, HISTORY_MIGRATION_LAST_UPDATED_DEFAULT_TIME } = require('../../../../constants');
const { MigrateToCloudStorageRunner } = require('../../../../operations/history/script/migrateToCloudStorageRunner');

describe('Binary history resource S3 read test', () => {
    let requestId;
    let savedEnv;

    beforeAll(() => {
        savedEnv = {
            HISTORY_RESOURCE_BUCKET_NAME: process.env.HISTORY_RESOURCE_BUCKET_NAME,
            HISTORY_RESOURCE_CLOUD_STORAGE_CLIENT: process.env.HISTORY_RESOURCE_CLOUD_STORAGE_CLIENT,
            BASE64_FIELD_CLOUD_STORAGE_ENABLED: process.env.BASE64_FIELD_CLOUD_STORAGE_ENABLED,
            BASE64_FIELD_CLOUD_STORAGE_CLIENT: process.env.BASE64_FIELD_CLOUD_STORAGE_CLIENT,
            RESOURCE_BUCKET_NAME: process.env.RESOURCE_BUCKET_NAME
        };
        process.env.HISTORY_RESOURCE_BUCKET_NAME = 'test';
        process.env.HISTORY_RESOURCE_CLOUD_STORAGE_CLIENT = CLOUD_STORAGE_CLIENTS.S3_CLIENT;
        process.env.BASE64_FIELD_CLOUD_STORAGE_ENABLED = '1';
        process.env.BASE64_FIELD_CLOUD_STORAGE_CLIENT = CLOUD_STORAGE_CLIENTS.S3_CLIENT;
        process.env.RESOURCE_BUCKET_NAME = 'test-live';
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

    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
        jest.clearAllMocks();
    });

    test('Binary history resource should be read from S3 when MongoDB document have S3 file path', async () => {
        const request = await createTestRequest((c) => {
            c.register(
                'historyResourceCloudStorageClient',
                (c) => {
                    if (c.configManager.historyResourceCloudStorageClient === CLOUD_STORAGE_CLIENTS.S3_CLIENT){
                        return new MockS3Client({
                            bucketName: c.configManager.historyResourceBucketName,
                            region: c.configManager.awsRegion
                        })
                    }
                    return null;
                }
            );
            c.register(
                'base64FieldCloudStorageClient',
                (c) => {
                    if (c.configManager.base64FieldCloudStorageClient === CLOUD_STORAGE_CLIENTS.S3_CLIENT){
                        return new MockS3Client({
                            bucketName: c.configManager.resourceBucketName,
                            region: c.configManager.awsRegion
                        })
                    }
                    return null;
                }
            );
            c.register(
                'migrateToCloudStorageRunner',
                (c) =>
                    new MigrateToCloudStorageRunner({
                        mongoDatabaseManager: c.mongoDatabaseManager,
                        collectionName: 'Binary_4_0_0_History',
                        batchSize: 100,
                        limit: 100000,
                        historyResourceCloudStorageClient: c.historyResourceCloudStorageClient,
                        configManager: c.configManager
                    })
            );
            return c;
        });
        const container = getTestContainer();

        const mockUploadAsync = jest.spyOn(
            container.historyResourceCloudStorageClient,
            'uploadAsync'
        );

        const mockDownloadInBatchAsync = jest.spyOn(
            container.historyResourceCloudStorageClient,
            'downloadInBatchAsync'
        );

        const mockDownloadAsync = jest.spyOn(
            container.historyResourceCloudStorageClient,
            'downloadAsync'
        );

        // Create resource
        let resp = await request.post('/4_0_0/Binary/1/$merge').send(binaryResources).set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

        const postRequestProcessor = container.postRequestProcessor;
        await postRequestProcessor.waitTillDoneAsync({ requestId });

        /**
         * @type {HistoryTestMongoDatabaseManager}
         */
        const mongoDatabaseManager = container.mongoDatabaseManager;
        /**
         * mongo fhirDb connection
         * @type {import('mongodb').Db}
         */
        const resourceHistoryDb = await mongoDatabaseManager.getResourceHistoryDbAsync();
        const resourceHistoryCollections = await resourceHistoryDb.listCollections().toArray();
        const resourceHistoryCollectionNames = resourceHistoryCollections.map(
            (collection) => collection.name
        );
        expect(resourceHistoryCollectionNames).toEqual(
            expect.arrayContaining(['Binary_4_0_0', 'Binary_4_0_0_History'])
        );
        const binaryHistoryCollection = resourceHistoryDb.collection('Binary_4_0_0_History');
        // Setting last updated of history to older than 1 hour
        await binaryHistoryCollection.updateMany(
            {},
            { $set: { 'resource.meta.lastUpdated': new Date(Date.now() - 2 * HISTORY_MIGRATION_LAST_UPDATED_DEFAULT_TIME) } }
        );

        // move history to S3
        const migrateToCloudStorageRunner = container.migrateToCloudStorageRunner;
        await migrateToCloudStorageRunner.processAsync();

        /**
         * @type {import('mongodb').DefaultSchema[]}
         */
        const binaryHistoryEntries = await binaryHistoryCollection.find({}).toArray();

        binaryHistoryEntries.forEach((entry) => {
            entry._id = null;
            entry.resource.meta.lastUpdated = null;
        });

        expect(binaryHistoryEntries).toEqual(expectedBinaryHistoryWithS3Path);

        expect(mockUploadAsync).toHaveBeenCalledTimes(2);
        // to ignore updated lastUpdated field
        Object.keys(expectedBinaryHistoryS3Data).forEach(key => {
            expectedBinaryHistoryS3Data[key].resource.meta.lastUpdated = expect.any(String);
            expectedBinaryHistoryS3Data[key]._id = expect.any(String);
        });

        let filePaths = expectedBinaryHistoryWithS3Path.map((item) => `Binary_4_0_0_History/${item?.resource?._uuid}/${item._ref}.json`)
        const cloudStorageData = container.historyResourceCloudStorageClient.downloadInBatchAsync({filePaths, batch: 100});
        Object.keys(cloudStorageData).forEach(key => {
            cloudStorageData[key] = JSON.parse(cloudStorageData[key]);
        });
        expect(cloudStorageData).toEqual(expectedBinaryHistoryS3Data);

        // complete history data is returned when response is returned from S3
        resp = await request.get('/4_0_0/Binary/_history').set(getHeaders());
        expect(resp).toHaveResponse(expectedHistoryData);

        resp = await request.get('/4_0_0/Binary/c15b781e-a52d-527f-a43b-9bb39a920fa0/_history').set(getHeaders());
        expect(resp).toHaveResponse(expectedHistoryByIdData);

        resp = await request.get('/4_0_0/Binary/c15b781e-a52d-527f-a43b-9bb39a920fa0/_history/1').set(getHeaders());
        expect(resp).toHaveResponse(expectedHistoryByVersionIdData);

        expect(mockDownloadInBatchAsync.mock.calls).toEqual([
            [
                {
                    batch: 100,
                    filePaths: [
                        'Binary_4_0_0_History/c15b781e-a52d-527f-a43b-9bb39a920fa0/randomUUID-7.json',
                        'Binary_4_0_0_History/bd19ed65-8e11-5dbd-bd68-c6c6d2e5e019/randomUUID-8.json'
                    ]
                }
            ],
            [
                {
                    batch: 100,
                    filePaths: [
                        'Binary_4_0_0_History/c15b781e-a52d-527f-a43b-9bb39a920fa0/randomUUID-7.json',
                        'Binary_4_0_0_History/bd19ed65-8e11-5dbd-bd68-c6c6d2e5e019/randomUUID-8.json'
                    ]
                }
            ],
            [{ batch: 100, filePaths: ['Binary_4_0_0_History/c15b781e-a52d-527f-a43b-9bb39a920fa0/randomUUID-7.json'] }]
        ]);

        expect(mockDownloadAsync.mock.calls).toEqual([['Binary_4_0_0_History/c15b781e-a52d-527f-a43b-9bb39a920fa0/randomUUID-7.json']]);

        // partial history data is returned when response is not returned from S3
        mockDownloadInBatchAsync.mockReturnValue({});
        mockDownloadAsync.mockReturnValue(null);

        resp = await request.get('/4_0_0/Binary/_history').set(getHeaders());
        expect(resp).toHaveResponse(expectedPartialHistoryData);

        resp = await request.get('/4_0_0/Binary/c15b781e-a52d-527f-a43b-9bb39a920fa0/_history').set(getHeaders());
        expect(resp).toHaveResponse(expectedPartialHistoryByIdData);

        resp = await request.get('/4_0_0/Binary/c15b781e-a52d-527f-a43b-9bb39a920fa0/_history/1').set(getHeaders());
        expect(resp).toHaveResponse(expectedPartialHistoryByVersionIdData);
    });

    test('Binary history resource should not be written to S3 when configured', async () => {
        let cloudStorageHistoryResources = process.env.CLOUD_STORAGE_HISTORY_RESOURCES;
        process.env.CLOUD_STORAGE_HISTORY_RESOURCES = 'Observation';

        const request = await createTestRequest((c) => {
            c.register(
                'historyResourceCloudStorageClient',
                (c) => {
                    if (c.configManager.historyResourceCloudStorageClient === CLOUD_STORAGE_CLIENTS.S3_CLIENT){
                        return new MockS3Client({
                            bucketName: c.configManager.historyResourceBucketName,
                            region: c.configManager.awsRegion
                        })
                    }
                    return null;
                }
            );
            return c;
        });
        const container = getTestContainer();

        const mockUploadAsync = jest.spyOn(
            container.historyResourceCloudStorageClient,
            'uploadAsync'
        );

        const mockDownloadInBatchAsync = jest.spyOn(
            container.historyResourceCloudStorageClient,
            'downloadInBatchAsync'
        );

        const mockDownloadAsync = jest.spyOn(
            container.historyResourceCloudStorageClient,
            'downloadAsync'
        );

        // Create resource
        let resp = await request.post('/4_0_0/Binary/1/$merge').send(binaryResources).set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

        const postRequestProcessor = container.postRequestProcessor;
        await postRequestProcessor.waitTillDoneAsync({ requestId });

        /**
         * @type {HistoryTestMongoDatabaseManager}
         */
        const mongoDatabaseManager = container.mongoDatabaseManager;
        /**
         * mongo fhirDb connection
         * @type {import('mongodb').Db}
         */
        const resourceHistoryDb = await mongoDatabaseManager.getResourceHistoryDbAsync();
        const resourceHistoryCollections = await resourceHistoryDb.listCollections().toArray();
        const resourceHistoryCollectionNames = resourceHistoryCollections.map(
            (collection) => collection.name
        );
        expect(resourceHistoryCollectionNames).toEqual(
            expect.arrayContaining(['Binary_4_0_0', 'Binary_4_0_0_History'])
        );
        const binaryHistoryCollection = resourceHistoryDb.collection('Binary_4_0_0_History');
        /**
         * @type {import('mongodb').DefaultSchema[]}
         */
        const binaryHistoryEntries = await binaryHistoryCollection.find({}).toArray();

        binaryHistoryEntries.forEach((entry) => {
            entry._id = null;
            entry.resource.meta.lastUpdated = null;
        });

        expect(binaryHistoryEntries).toEqual(expectedBinaryHistory);

        expect(mockUploadAsync).toHaveBeenCalledTimes(0);

        resp = await request.get('/4_0_0/Binary/_history').set(getHeaders());
        expect(resp).toHaveResponse(expectedHistoryData);

        resp = await request.get('/4_0_0/Binary/c15b781e-a52d-527f-a43b-9bb39a920fa0/_history').set(getHeaders());
        expect(resp).toHaveResponse(expectedHistoryByIdData);

        resp = await request.get('/4_0_0/Binary/c15b781e-a52d-527f-a43b-9bb39a920fa0/_history/1').set(getHeaders());
        expect(resp).toHaveResponse(expectedHistoryByVersionIdData);

        expect(mockDownloadInBatchAsync).toHaveBeenCalledTimes(0);
        expect(mockDownloadAsync).toHaveBeenCalledTimes(0);
        if (cloudStorageHistoryResources === undefined) {
            delete process.env.CLOUD_STORAGE_HISTORY_RESOURCES;
        } else {
            process.env.CLOUD_STORAGE_HISTORY_RESOURCES = cloudStorageHistoryResources;
        }
    });

    test('Binary history already migrated to S3 with a base64 _blobMeta sidecar can still be read after disabling ENABLE_HISTORY_TO_CLOUD_STORAGE_MIGRATION', async () => {
        const enableHistoryToCloudStorageMigration = process.env.ENABLE_HISTORY_TO_CLOUD_STORAGE_MIGRATION;

        const request = await createTestRequest();
        const container = getTestContainer();
        for (const methodName of ['downloadInBatchAsync', 'downloadAsync', 'uploadAsync']) {
            const method = container.historyResourceCloudStorageClient[methodName];
            if (jest.isMockFunction(method)) {
                method.mockRestore();
            }
        }

        const id = 'binary-double-externalized';
        const largeData = 'A'.repeat(80 * 1024);

        const binaryResource = {
            resourceType: 'Binary',
            id,
            meta: {
                source: 'https://connect.medlineplus.gov/service',
                security: [
                    { system: 'https://www.icanbwell.com/owner', code: 'client1' },
                    { system: 'https://www.icanbwell.com/access', code: 'client1' },
                    { system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'client1' }
                ]
            },
            contentType: 'text/html',
            data: largeData
        };

        let resp = await request.put(`/4_0_0/Binary/${id}`).send(binaryResource).set(getHeaders());
        expect(resp.statusCode).toBe(201);

        const postRequestProcessor = container.postRequestProcessor;
        await postRequestProcessor.waitTillDoneAsync({ requestId });

        const mongoDatabaseManager = container.mongoDatabaseManager;
        const resourceHistoryDb = await mongoDatabaseManager.getResourceHistoryDbAsync();
        const binaryHistoryCollection = resourceHistoryDb.collection('Binary_4_0_0_History');

        const historyDocsBeforeMigration = await binaryHistoryCollection.find({ 'resource._sourceId': id }).toArray();
        expect(historyDocsBeforeMigration.length).toBe(1);
        expect(historyDocsBeforeMigration[0].resource._blobMeta).toBeDefined();
        expect(historyDocsBeforeMigration[0].resource.data).toBeUndefined();

        await binaryHistoryCollection.updateMany(
            { 'resource._sourceId': id },
            { $set: { 'resource.meta.lastUpdated': new Date(Date.now() - 2 * HISTORY_MIGRATION_LAST_UPDATED_DEFAULT_TIME) } }
        );

        const migrateToCloudStorageRunner = container.migrateToCloudStorageRunner;
        await migrateToCloudStorageRunner.processAsync();

        const historyDocsAfterMigration = await binaryHistoryCollection.find({ 'resource._sourceId': id }).toArray();
        expect(historyDocsAfterMigration.length).toBe(1);
        expect(historyDocsAfterMigration[0]._ref).toBeDefined();
        expect(historyDocsAfterMigration[0].resource._blobMeta).toBeUndefined();

        process.env.ENABLE_HISTORY_TO_CLOUD_STORAGE_MIGRATION = 'false';
        expect(container.configManager.enableHistoryToCloudStorageMigration).toBe(false);

        try {
            resp = await request.get(`/4_0_0/Binary/${id}/_history`).set(getHeaders());
            expect(resp.statusCode).toBe(200);
            expect(resp.body.entry.length).toBe(1);
            expect(resp.body.entry[0].resource.data).toBe(largeData);
            expect(resp.body.entry[0].resource._blobMeta).toBeUndefined();

            resp = await request.get(`/4_0_0/Binary/${id}/_history/1`).set(getHeaders());
            expect(resp.statusCode).toBe(200);
            expect(resp.body.data).toBe(largeData);
        } finally {
            if (enableHistoryToCloudStorageMigration === undefined) {
                delete process.env.ENABLE_HISTORY_TO_CLOUD_STORAGE_MIGRATION;
            } else {
                process.env.ENABLE_HISTORY_TO_CLOUD_STORAGE_MIGRATION = enableHistoryToCloudStorageMigration;
            }
        }
    });
});
