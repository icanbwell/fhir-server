// test file
const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer
} = require('../common');
const { describe, beforeAll, afterAll, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { BulkDataExportRunner } = require('../../operations/export/script/bulkDataExportRunner');
const { MockK8sClient } = require('./mocks/k8sClient');
const { MockS3Client } = require('./mocks/s3Client');
const { generateUUID } = require('../../utils/uid.util');
const { CLOUD_STORAGE_CLIENTS } = require('../../constants');

// 80 KB string — exceeds the 64 KB threshold set below, so create() offloads it to S3.
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

describe('Export Binary S3 Hydration Tests', () => {
    let savedEnv;

    // Set before the first createTestRequest() call in this file — configManager reads these once
    // at container-build time (this file's container is fresh; see reference-test-container-caching).
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
        process.env.RESOURCE_BUCKET_NAME = 'test-base64-live-bucket';
        process.env.HISTORY_RESOURCE_CLOUD_STORAGE_CLIENT = CLOUD_STORAGE_CLIENTS.S3_CLIENT;
        process.env.HISTORY_RESOURCE_BUCKET_NAME = 'test-base64-history-bucket';
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
        c.register('k8sClient', (cc) => new MockK8sClient({ configManager: cc.configManager }));
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
        process.env.ENABLE_BULK_EXPORT = '1';
        const container = getTestContainer();
        if (container) {
            delete container.services.bulkDataExportRunner;
        }
        await commonBeforeEach();
    });

    afterEach(async () => {
        process.env.ENABLE_BULK_EXPORT = '0';
        await commonAfterEach();
    });

    test('Export includes inlined data for a Binary resource offloaded to S3', async () => {
        const request = await createTestRequest(registerMockClients);
        const postRequestProcessor = getTestContainer().postRequestProcessor;
        const postSaveProcessor = getTestContainer().postSaveProcessor;

        // Create a Binary whose data exceeds the 64KB threshold, so create() offloads it to S3
        // and leaves only a _blobMeta sidecar in Mongo. PUT (not $merge) so the id is deterministic.
        const binaryId = 'export-large-binary';
        const putResp = await request
            .put(`/4_0_0/Binary/${binaryId}`)
            .send(buildBinary({ id: binaryId, data: LARGE_DATA }))
            .set(getHeaders())
            .expect(201);

        expect(putResp.body.data).toBe(LARGE_DATA);
        expect(putResp.body._blobMeta).toBeUndefined();

        let resp = await request
            .post('/4_0_0/$export?_type=Binary')
            .set(getHeaders())
            .expect(202);

        expect(resp.headers['content-location']).toBeDefined();
        const exportStatusId = resp.headers['content-location'].split('/').pop();

        const container = getTestContainer();
        const requestId = generateUUID();
        const exportS3Client = new MockS3Client({ bucketName: 'test', region: 'test' });

        container.register('bulkDataExportRunner', (c) => new BulkDataExportRunner({
            databaseQueryFactory: c.databaseQueryFactory,
            databaseExportManager: c.databaseExportManager,
            patientFilterManager: c.patientFilterManager,
            databaseAttachmentManager: c.databaseAttachmentManager,
            base64DataManager: c.base64DataManager,
            r4SearchQueryCreator: c.r4SearchQueryCreator,
            patientQueryCreator: c.patientQueryCreator,
            enrichmentManager: c.enrichmentManager,
            resourceLocatorFactory: c.resourceLocatorFactory,
            r4ArgsParser: c.r4ArgsParser,
            searchManager: c.searchManager,
            postSaveProcessor: c.postSaveProcessor,
            bulkExportEventProducer: c.bulkExportEventProducer,
            exportStatusId,
            patientReferenceBatchSize: 1000,
            uploadPartSize: 1024 * 1024,
            s3Client: exportS3Client,
            requestId
        }));

        const bulkDataExportRunner = container.bulkDataExportRunner;
        await bulkDataExportRunner.processAsync();
        await postRequestProcessor.executeAsync({ requestId });
        await postSaveProcessor.flushAsync();

        resp = await request
            .get(`/4_0_0/$export/${exportStatusId}`)
            .set(getHeaders())
            .expect(200);

        expect(resp.body.output).toHaveLength(1);
        expect(resp.body.output[0].type).toEqual('Binary');
        expect(resp.body.errors).toHaveLength(0);

        const exportedFilePath = `${bulkDataExportRunner.baseS3Folder}/Binary.ndjson`;
        const exportedNdjson = exportS3Client.uploadedData[exportedFilePath];
        expect(exportedNdjson).toBeDefined();

        const exportedBinary = JSON.parse(exportedNdjson.trim());
        expect(exportedBinary.data).toBe(LARGE_DATA);
        expect(exportedBinary._blobMeta).toBeUndefined();
    });
});
