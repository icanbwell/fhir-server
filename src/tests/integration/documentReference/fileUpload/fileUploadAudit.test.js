const documentReference1Resource = require('./fixtures/DocumentReference/documentReference1.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer,
    mockHttpContext
} = require('../../common');
const { describe, beforeAll, afterAll, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { MockS3Client } = require('../../export/mocks/s3Client');
const { AuditLogger } = require('../../../../utils/auditLogger');

class TestDocumentReferenceFileS3Client extends MockS3Client {
    async getPresignedPutUrlAsync ({ filePath, expiresInSeconds }) {
        return `https://mock-s3.example/${this.bucketName}/${filePath}?mock=upload&expiresIn=${expiresInSeconds}`;
    }

    async getPresignedGetUrlAsync ({ filePath, expiresInSeconds }) {
        return `https://mock-s3.example/${this.bucketName}/${filePath}?mock=download&expiresIn=${expiresInSeconds}`;
    }
}

function extractKeyFromMockUrl (url) {
    const { pathname } = new URL(url);
    const [, , ...keyParts] = pathname.split('/');
    return keyParts.join('/');
}

describe('DocumentReference $fileUpload / $fileDownload — audit trail', () => {
    let savedEnv;

    beforeAll(() => {
        savedEnv = {
            ENABLE_DOCUMENT_REFERENCE_FILE_OPERATIONS: process.env.ENABLE_DOCUMENT_REFERENCE_FILE_OPERATIONS,
            DOCUMENT_REFERENCE_FILE_BUCKET_NAME: process.env.DOCUMENT_REFERENCE_FILE_BUCKET_NAME
        };
        process.env.ENABLE_DOCUMENT_REFERENCE_FILE_OPERATIONS = '1';
        process.env.DOCUMENT_REFERENCE_FILE_BUCKET_NAME = 'test-document-reference-file-bucket';
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

    const registerMockClientAndRealAuditLogger = (c) => {
        c.register('documentReferenceFileCloudStorageClient', (cc) => new TestDocumentReferenceFileS3Client({
            bucketName: cc.configManager.documentReferenceFileBucketName,
            region: cc.configManager.awsRegion
        }));
        c.register('auditLogger', (cc) => new AuditLogger({
            postRequestProcessor: cc.postRequestProcessor,
            databaseBulkInserter: cc.fastDatabaseBulkInserter,
            preSaveManager: cc.preSaveManager,
            configManager: cc.configManager
        }));
        return c;
    };

    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('$fileUpload and $fileDownload each create an AuditEvent', async () => {
        const request = await createTestRequest(registerMockClientAndRealAuditLogger);
        const container = getTestContainer();
        const requestId = mockHttpContext();

        let resp = await request
            .put(`/4_0_0/DocumentReference/${documentReference1Resource.id}`)
            .send(documentReference1Resource)
            .set(getHeaders());
        expect(resp.status).toBe(201);

        resp = await request
            .post(`/4_0_0/DocumentReference/${documentReference1Resource.id}/$fileUpload`)
            .send({ resourceType: 'Parameters', parameter: [{ name: 'fileName', valueString: 'audited.pdf' }] })
            .set(getHeaders());
        expect(resp.status).toBe(200);
        const { contentId, uploadUrl } = resp.body;
        const s3Key = extractKeyFromMockUrl(uploadUrl);
        await container.documentReferenceFileCloudStorageClient.uploadAsync({ filePath: s3Key, data: 'bytes' });

        resp = await request
            .get(`/4_0_0/DocumentReference/${documentReference1Resource.id}/${contentId}/$fileDownload`)
            .set(getHeaders());
        expect(resp.status).toBe(302);

        await container.postRequestProcessor.waitTillDoneAsync({ requestId });
        await container.auditLogger.flushAsync();

        const auditDb = await container.mongoDatabaseManager.getAuditDbAsync();
        const auditEvents = await auditDb.collection('AuditEvent_4_0_0').find({}).toArray();
        const actions = auditEvents.map((e) => e.action);
        expect(actions.filter((a) => a === 'U')).toHaveLength(2);
        expect(actions.filter((a) => a === 'R')).toHaveLength(1);
    });
});
