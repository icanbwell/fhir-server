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
// need to be above other imports
jest.spyOn(utils, 'generateUUID').mockReturnValue('randomUUID');

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
const expectedBinaryHistoryS3Data = require('./fixtures/expected/expectedBinaryHistoryS3Data.json');

describe('Binary history resource should be written to S3', () => {
    let requestId;
    let enableHistoryResourceS3Upload;

    beforeAll(() => {
        enableHistoryResourceS3Upload = env.ENABLE_HISTORY_RESOURCE_S3_UPLOAD;
        env.ENABLE_HISTORY_RESOURCE_S3_UPLOAD = 'true';
    });

    afterAll(() => {
        env.ENABLE_HISTORY_RESOURCE_S3_UPLOAD = enableHistoryResourceS3Upload;
    });

    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('Binary history resource should be written to S3 and MongoDB document should have S3 file path', async () => {
        const request = await createTestRequest((c) => {
            c.register(
                'historyResourceS3Client',
                (c) =>
                    new MockS3Client({
                        bucketName: 'test',
                        region: 'test'
                    })
            );
            return c;
        });
        const container = getTestContainer();

        const mockS3UploadInBatchAsync = jest.spyOn(
            container.historyResourceS3Client,
            'uploadInBatchAsync'
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
        expect(mockS3UploadInBatchAsync).toHaveReturnedWith(expectedBinaryHistoryS3Data);
    });
});
