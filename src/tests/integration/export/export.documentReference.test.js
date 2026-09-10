// test file
const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer
} = require('../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { BulkDataExportRunner } = require('../../../operations/export/script/bulkDataExportRunner');
const { MockK8sClient } = require('./mocks/k8sClient');
const { MockS3Client } = require('./mocks/s3Client');
const { generateUUID } = require('../../../utils/uid.util');

const buildDocumentReference = ({ id, data }) => ({
    resourceType: 'DocumentReference',
    id,
    meta: {
        source: 'https://test.example.com/source',
        security: [
            { system: 'https://www.icanbwell.com/owner', code: 'test' },
            { system: 'https://www.icanbwell.com/access', code: 'test' },
            { system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'test' }
        ]
    },
    status: 'current',
    content: [
        {
            attachment: {
                contentType: 'application/pdf',
                data
            }
        }
    ]
});

describe('Export DocumentReference GridFS Hydration Tests', () => {
    const registerMockClients = (c) => {
        c.register('k8sClient', (cc) => new MockK8sClient({ configManager: cc.configManager }));
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

    const runExport = async ({ request, query }) => {
        const postRequestProcessor = getTestContainer().postRequestProcessor;
        const postSaveProcessor = getTestContainer().postSaveProcessor;

        let resp = await request
            .post(`/4_0_0/$export?_type=DocumentReference${query}`)
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
            storageProviderFactory: c.storageProviderFactory,
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

        expect(resp.body.errors).toHaveLength(0);

        const exportedFilePath = `${bulkDataExportRunner.baseS3Folder}/DocumentReference.ndjson`;
        const exportedNdjson = exportS3Client.uploadedData[exportedFilePath];
        expect(exportedNdjson).toBeDefined();

        return exportedNdjson
            .trim()
            .split('\n')
            .filter((line) => line.length > 0)
            .map((line) => JSON.parse(line));
    };

    test('Export includes GridFS-offloaded data for a DocumentReference resource', async () => {
        const request = await createTestRequest(registerMockClients);

        const docId = 'export-docref-full';
        const data = 'ZnVsbC1leHBvcnQtZG9jcmVmLWRhdGE=';
        await request
            .put(`/4_0_0/DocumentReference/${docId}`)
            .send(buildDocumentReference({ id: docId, data }))
            .set(getHeaders())
            .expect(201);

        const exportedDocs = await runExport({ request, query: '' });

        expect(exportedDocs).toHaveLength(1);
        expect(exportedDocs[0].content[0].attachment.data).toBe(data);
        expect(exportedDocs[0].content[0].attachment._file_id).toBeUndefined();
    });

    test('Export with _elements=id,content still rehydrates GridFS data for a projected DocumentReference', async () => {
        const request = await createTestRequest(registerMockClients);

        const docId = 'export-docref-elements';
        const data = 'cHJvamVjdGVkLWRvY3JlZi1kYXRh';
        await request
            .put(`/4_0_0/DocumentReference/${docId}`)
            .send(buildDocumentReference({ id: docId, data }))
            .set(getHeaders())
            .expect(201);

        const exportedDocs = await runExport({ request, query: '&_elements=id,content' });

        expect(exportedDocs).toHaveLength(1);
        expect(exportedDocs[0].content[0].attachment.data).toBe(data);
        expect(exportedDocs[0].content[0].attachment._file_id).toBeUndefined();
    });

    test('Export with _elements=id omits content entirely and does not leak _file_id', async () => {
        const request = await createTestRequest(registerMockClients);

        const docId = 'export-docref-id-only';
        const data = 'aWQtb25seS1kb2NyZWYtZGF0YQ==';
        await request
            .put(`/4_0_0/DocumentReference/${docId}`)
            .send(buildDocumentReference({ id: docId, data }))
            .set(getHeaders())
            .expect(201);

        const exportedDocs = await runExport({ request, query: '&_elements=id' });

        expect(exportedDocs).toHaveLength(1);
        expect(exportedDocs[0].content).toBeUndefined();
        expect(exportedDocs[0]._file_id).toBeUndefined();
        expect(exportedDocs[0].id).toBe(docId);
    });
});
