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
const env = require('var');

const utils = require('../../../utils/uid.util');
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
const { CLOUD_STORAGE_CLIENTS } = require('../../../constants');

describe('Binary history resource should be written to S3', () => {
    let requestId;
    let historyResourceCloudStorageBucket;
    let historyResourceCloudStorageClient;

    beforeAll(() => {
        historyResourceCloudStorageBucket = env.HISTORY_RESOURCE_BUCKET_NAME;
        historyResourceCloudStorageClient = env.HISTORY_RESOURCE_CLOUD_STORAGE_CLIENT;
        env.HISTORY_RESOURCE_BUCKET_NAME = 'test';
        env.HISTORY_RESOURCE_CLOUD_STORAGE_CLIENT = CLOUD_STORAGE_CLIENTS.S3_CLIENT;
    });

    afterAll(() => {
        env.HISTORY_RESOURCE_BUCKET_NAME = historyResourceCloudStorageBucket;
        env.HISTORY_RESOURCE_CLOUD_STORAGE_CLIENT = historyResourceCloudStorageClient;
    });

    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
        jest.clearAllMocks();
    });

    test('Binary history resource should be written to S3 and MongoDB document should have S3 file path', async () => {
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

        expect(binaryHistoryEntries).toEqual(expectedBinaryHistoryWithS3Path);

        expect(mockUploadAsync).toHaveBeenCalledTimes(2);
        // to ignore updated lastUpdated field
        Object.keys(expectedBinaryHistoryS3Data).forEach(key => {
            expectedBinaryHistoryS3Data[key].resource.meta.lastUpdated = expect.any(String);
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
                        'Binary_4_0_0_History/c15b781e-a52d-527f-a43b-9bb39a920fa0/randomUUID-11.json',
                        'Binary_4_0_0_History/bd19ed65-8e11-5dbd-bd68-c6c6d2e5e019/randomUUID-12.json'
                    ]
                }
            ],
            [
                {
                    batch: 100,
                    filePaths: [
                        'Binary_4_0_0_History/c15b781e-a52d-527f-a43b-9bb39a920fa0/randomUUID-11.json',
                        'Binary_4_0_0_History/bd19ed65-8e11-5dbd-bd68-c6c6d2e5e019/randomUUID-12.json'
                    ]
                }
            ],
            [{ batch: 100, filePaths: ['Binary_4_0_0_History/c15b781e-a52d-527f-a43b-9bb39a920fa0/randomUUID-11.json'] }]
        ]);

        expect(mockDownloadAsync.mock.calls).toEqual([['Binary_4_0_0_History/c15b781e-a52d-527f-a43b-9bb39a920fa0/randomUUID-11.json']]);

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
        let cloudStorageHistoryResources = env.CLOUD_STORAGE_HISTORY_RESOURCES;
        env.CLOUD_STORAGE_HISTORY_RESOURCES = 'Observation';

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
        env.CLOUD_STORAGE_HISTORY_RESOURCES = cloudStorageHistoryResources;
    });
});
