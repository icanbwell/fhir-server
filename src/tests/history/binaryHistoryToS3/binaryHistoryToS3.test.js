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
const expectedPartialHistoryData = require('./expected/expected_partial_history.json');
const expectedPartialHistoryByIdData = require('./expected/expected_partial_history_by_id.json');
const expectedHistoryData = require('./expected/expected_history.json');
const expectedHistoryByIdData = require('./expected/expected_history_by_id.json');
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

        const mockUploadInBatchAsync = jest.spyOn(
            container.historyResourceCloudStorageClient,
            'uploadInBatchAsync'
        );

        const mockDownloadInBatchAsync = jest.spyOn(
            container.historyResourceCloudStorageClient,
            'downloadInBatchAsync'
        );

        // Create resource
        resp = await request.post('/4_0_0/Binary/1/$merge').send(binaryResources).set(getHeaders());
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

        // to ignore updated lastUpdated field
        expectedBinaryHistoryS3Data.fileDataWithPath.forEach((element) => {
            element.data.resource.meta.lastUpdated = expect.any(String);
            return element;
        });
        expect(mockUploadInBatchAsync).toHaveReturnedWith(expectedBinaryHistoryS3Data);

        // complete history data is returned when response is returned from S3
        resp = await request.get('/4_0_0/Binary/_history').set(getHeaders());
        expect(resp).toHaveResponse(expectedHistoryData);

        resp = await request.get('/4_0_0/Binary/c15b781e-a52d-527f-a43b-9bb39a920fa0/_history').set(getHeaders());
        expect(resp).toHaveResponse(expectedHistoryByIdData);

        expect(mockDownloadInBatchAsync.mock.calls).toEqual([
            [
                {
                    batch: 100,
                    filePaths: [
                        's3://test/Binary_4_0_0_History/randomUUID-11.json',
                        's3://test/Binary_4_0_0_History/randomUUID-12.json'
                    ]
                }
            ],
            [{ batch: 100, filePaths: ['s3://test/Binary_4_0_0_History/randomUUID-11.json'] }]
        ]);

        // partial history data is returned when response is not returned from S3
        mockDownloadInBatchAsync.mockReturnValue({});

        resp = await request.get('/4_0_0/Binary/_history').set(getHeaders());
        expect(resp).toHaveResponse(expectedPartialHistoryData);

        resp = await request.get('/4_0_0/Binary/c15b781e-a52d-527f-a43b-9bb39a920fa0/_history').set(getHeaders());
        expect(resp).toHaveResponse(expectedPartialHistoryByIdData);
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

        const mockUploadInBatchAsync = jest.spyOn(
            container.historyResourceCloudStorageClient,
            'uploadInBatchAsync'
        );

        const mockDownloadInBatchAsync = jest.spyOn(
            container.historyResourceCloudStorageClient,
            'downloadInBatchAsync'
        );

        // Create resource
        resp = await request.post('/4_0_0/Binary/1/$merge').send(binaryResources).set(getHeaders());
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

        // to ignore updated lastUpdated field
        expectedBinaryHistoryS3Data.fileDataWithPath.forEach((element) => {
            element.data.resource.meta.lastUpdated = expect.any(String);
            return element;
        });
        expect(mockUploadInBatchAsync).toHaveBeenCalledTimes(0);

        resp = await request.get('/4_0_0/Binary/_history').set(getHeaders());
        expect(resp).toHaveResponse(expectedHistoryData);

        resp = await request.get('/4_0_0/Binary/c15b781e-a52d-527f-a43b-9bb39a920fa0/_history').set(getHeaders());
        expect(resp).toHaveResponse(expectedHistoryByIdData);

        expect(mockDownloadInBatchAsync).toHaveBeenCalledTimes(0);
        env.CLOUD_STORAGE_HISTORY_RESOURCES = cloudStorageHistoryResources;
    });
});
