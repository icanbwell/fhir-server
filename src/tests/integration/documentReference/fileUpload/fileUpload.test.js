const documentReference1Resource = require('./fixtures/DocumentReference/documentReference1.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer
} = require('../../common');
const { describe, beforeAll, afterAll, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { MockS3Client } = require('../../export/mocks/s3Client');

class TestDocumentReferenceFileS3Client extends MockS3Client {
    async getPresignedPutUrlAsync({ filePath, expiresInSeconds }) {
        return `https://mock-s3.example/${this.bucketName}/${filePath}?mock=upload&expiresIn=${expiresInSeconds}`;
    }

    async getPresignedGetUrlAsync({ filePath, expiresInSeconds, responseContentDisposition }) {
        const disposition = responseContentDisposition
            ? `&disposition=${encodeURIComponent(responseContentDisposition)}`
            : '';
        return `https://mock-s3.example/${this.bucketName}/${filePath}?mock=download&expiresIn=${expiresInSeconds}${disposition}`;
    }
}

/**
 * The mock presign methods embed the real S3 key as the URL path (after the bucket name),
 * so tests can recover it without needing the resource's internal _uuid.
 */
function extractKeyFromMockUrl (url) {
    const { pathname } = new URL(url);
    const [, , ...keyParts] = pathname.split('/'); // drop leading '' and bucket name segments
    return keyParts.join('/');
}

describe('DocumentReference $fileUpload / $fileDownload — enabled', () => {
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

    const registerMockClient = (c) => {
        c.register('documentReferenceFileCloudStorageClient', (cc) => new TestDocumentReferenceFileS3Client({
            bucketName: cc.configManager.documentReferenceFileBucketName,
            region: cc.configManager.awsRegion
        }));
        return c;
    };

    beforeEach(async () => {
        await commonBeforeEach();
        const container = getTestContainer();
        if (container && container.documentReferenceFileCloudStorageClient) {
            container.documentReferenceFileCloudStorageClient.uploadedData = {};
        }
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('$fileUpload appends a content[] entry and returns a presigned PUT url; $fileDownload redirects to a presigned GET url', async () => {
        const request = await createTestRequest(registerMockClient);
        const container = getTestContainer();

        let resp = await request
            .put(`/4_0_0/DocumentReference/${documentReference1Resource.id}`)
            .send(documentReference1Resource)
            .set(getHeaders());
        expect(resp.status).toBe(201);

        resp = await request
            .post(`/4_0_0/DocumentReference/${documentReference1Resource.id}/$fileUpload`)
            .send({
                resourceType: 'Parameters',
                parameter: [
                    { name: 'fileName', valueString: 'report.pdf' },
                    { name: 'contentType', valueString: 'application/pdf' }
                ]
            })
            .set(getHeaders());
        expect(resp.status).toBe(200);
        expect(resp.body.contentId).toEqual(expect.any(String));
        expect(resp.body.expiresAt).toEqual(expect.any(String));
        expect(resp.body.uploadUrl).toContain('mock=upload');
        expect(resp.body.uploadUrl).toContain(`/content/${resp.body.contentId}`);
        const { contentId, uploadUrl } = resp.body;
        const s3Key = extractKeyFromMockUrl(uploadUrl);

        // Confirm the resource now carries the new content[] entry, alongside the original one.
        resp = await request
            .get(`/4_0_0/DocumentReference/${documentReference1Resource.id}`)
            .set(getHeaders());
        expect(resp.status).toBe(200);
        expect(resp.body.content).toHaveLength(2);
        const newContentEntry = resp.body.content.find((c) => c.id === contentId);
        expect(newContentEntry).toBeDefined();
        expect(newContentEntry.attachment.title).toBe('report.pdf');
        expect(newContentEntry.attachment.contentType).toBe('application/pdf');
        expect(newContentEntry.attachment.url).toContain(`/DocumentReference/${documentReference1Resource.id}/${contentId}/$fileDownload`);

        // Simulate the client actually PUTting bytes to the presigned upload URL.
        await container.documentReferenceFileCloudStorageClient.uploadAsync({
            filePath: s3Key,
            data: 'fake-pdf-bytes'
        });

        resp = await request
            .get(`/4_0_0/DocumentReference/${documentReference1Resource.id}/${contentId}/$fileDownload`)
            .set(getHeaders());
        expect(resp.status).toBe(302);
        expect(resp.headers.location).toContain('mock=download');
        expect(resp.headers.location).toContain(`/content/${contentId}`);
        expect(resp.headers.location).toContain(encodeURIComponent('filename="report.pdf"'));
    });

    test('renaming attachment.title after upload does not break $fileDownload', async () => {
        const request = await createTestRequest(registerMockClient);
        const container = getTestContainer();

        let resp = await request
            .put(`/4_0_0/DocumentReference/${documentReference1Resource.id}`)
            .send(documentReference1Resource)
            .set(getHeaders());
        expect(resp.status).toBe(201);

        resp = await request
            .post(`/4_0_0/DocumentReference/${documentReference1Resource.id}/$fileUpload`)
            .send({ resourceType: 'Parameters', parameter: [{ name: 'fileName', valueString: 'original.pdf' }] })
            .set(getHeaders());
        expect(resp.status).toBe(200);
        const { contentId, uploadUrl } = resp.body;
        const s3Key = extractKeyFromMockUrl(uploadUrl);

        await container.documentReferenceFileCloudStorageClient.uploadAsync({
            filePath: s3Key,
            data: 'fake-pdf-bytes'
        });

        resp = await request
            .get(`/4_0_0/DocumentReference/${documentReference1Resource.id}`)
            .set(getHeaders());
        expect(resp.status).toBe(200);
        const updatedResource = resp.body;
        const contentEntry = updatedResource.content.find((c) => c.id === contentId);
        contentEntry.attachment.title = 'renamed.pdf';
        resp = await request
            .put(`/4_0_0/DocumentReference/${documentReference1Resource.id}`)
            .send(updatedResource)
            .set(getHeaders());
        expect(resp.status).toBe(200);

        resp = await request
            .get(`/4_0_0/DocumentReference/${documentReference1Resource.id}/${contentId}/$fileDownload`)
            .set(getHeaders());
        expect(resp.status).toBe(302);
        expect(resp.headers.location).toContain('mock=download');
    });

    test('$fileDownload forces Content-Disposition: attachment even for an inline-renderable contentType', async () => {
        const request = await createTestRequest(registerMockClient);
        const container = getTestContainer();

        let resp = await request
            .put(`/4_0_0/DocumentReference/${documentReference1Resource.id}`)
            .send(documentReference1Resource)
            .set(getHeaders());
        expect(resp.status).toBe(201);

        resp = await request
            .post(`/4_0_0/DocumentReference/${documentReference1Resource.id}/$fileUpload`)
            .send({
                resourceType: 'Parameters',
                parameter: [
                    { name: 'fileName', valueString: 'page.html' },
                    { name: 'contentType', valueString: 'text/html' }
                ]
            })
            .set(getHeaders());
        expect(resp.status).toBe(200);
        const { contentId, uploadUrl } = resp.body;
        const s3Key = extractKeyFromMockUrl(uploadUrl);

        await container.documentReferenceFileCloudStorageClient.uploadAsync({
            filePath: s3Key,
            data: '<script>alert(1)</script>'
        });

        resp = await request
            .get(`/4_0_0/DocumentReference/${documentReference1Resource.id}/${contentId}/$fileDownload`)
            .set(getHeaders());
        expect(resp.status).toBe(302);
        expect(resp.headers.location).toContain(encodeURIComponent('attachment'));
    });

    test('$fileUpload rejects a non-string contentType (e.g. duplicated query param parsed as an array)', async () => {
        const request = await createTestRequest(registerMockClient);
        const container = getTestContainer();

        let resp = await request
            .put(`/4_0_0/DocumentReference/${documentReference1Resource.id}`)
            .send(documentReference1Resource)
            .set(getHeaders());
        expect(resp.status).toBe(201);

        resp = await request
            .post(`/4_0_0/DocumentReference/${documentReference1Resource.id}/$fileUpload?contentType=text/plain&contentType=text/html`)
            .send({ resourceType: 'Parameters', parameter: [] })
            .set(getHeaders());
        expect(resp.status).toBe(400);
        expect(Object.keys(container.documentReferenceFileCloudStorageClient.uploadedData)).toHaveLength(0);
    });

    test('$fileUpload rejects a non-string fileName (e.g. duplicated query param parsed as an array)', async () => {
        const request = await createTestRequest(registerMockClient);
        const container = getTestContainer();

        let resp = await request
            .put(`/4_0_0/DocumentReference/${documentReference1Resource.id}`)
            .send(documentReference1Resource)
            .set(getHeaders());
        expect(resp.status).toBe(201);

        resp = await request
            .post(`/4_0_0/DocumentReference/${documentReference1Resource.id}/$fileUpload?fileName=a.pdf&fileName=b.pdf`)
            .send({ resourceType: 'Parameters', parameter: [] })
            .set(getHeaders());
        expect(resp.status).toBe(400);
        expect(Object.keys(container.documentReferenceFileCloudStorageClient.uploadedData)).toHaveLength(0);
    });

    test('$fileUpload works with no fileName/contentType supplied (binary upload, no filename segment)', async () => {
        const request = await createTestRequest(registerMockClient);

        let resp = await request
            .put(`/4_0_0/DocumentReference/${documentReference1Resource.id}`)
            .send(documentReference1Resource)
            .set(getHeaders());
        expect(resp.status).toBe(201);

        resp = await request
            .post(`/4_0_0/DocumentReference/${documentReference1Resource.id}/$fileUpload`)
            .send({ resourceType: 'Parameters', parameter: [] })
            .set(getHeaders());
        expect(resp.status).toBe(200);
        const s3Key = extractKeyFromMockUrl(resp.body.uploadUrl);
        expect(s3Key.endsWith(`/content/${resp.body.contentId}`)).toBe(true);
    });

    test('$fileUpload rejects a path-traversal fileName before touching S3', async () => {
        const request = await createTestRequest(registerMockClient);
        const container = getTestContainer();

        let resp = await request
            .put(`/4_0_0/DocumentReference/${documentReference1Resource.id}`)
            .send(documentReference1Resource)
            .set(getHeaders());
        expect(resp.status).toBe(201);

        resp = await request
            .post(`/4_0_0/DocumentReference/${documentReference1Resource.id}/$fileUpload`)
            .send({ resourceType: 'Parameters', parameter: [{ name: 'fileName', valueString: '../../etc/passwd' }] })
            .set(getHeaders());
        expect(resp.status).toBe(400);
        expect(Object.keys(container.documentReferenceFileCloudStorageClient.uploadedData)).toHaveLength(0);
    });

    test('$fileDownload returns 404 for an unknown contentId', async () => {
        const request = await createTestRequest(registerMockClient);

        let resp = await request
            .put(`/4_0_0/DocumentReference/${documentReference1Resource.id}`)
            .send(documentReference1Resource)
            .set(getHeaders());
        expect(resp.status).toBe(201);

        resp = await request
            .get(`/4_0_0/DocumentReference/${documentReference1Resource.id}/00000000-0000-0000-0000-000000000000/$fileDownload`)
            .set(getHeaders());
        expect(resp.status).toBe(404);
    });

    test('$fileDownload returns 404 when the upload never completed', async () => {
        const request = await createTestRequest(registerMockClient);

        let resp = await request
            .put(`/4_0_0/DocumentReference/${documentReference1Resource.id}`)
            .send(documentReference1Resource)
            .set(getHeaders());
        expect(resp.status).toBe(201);

        resp = await request
            .post(`/4_0_0/DocumentReference/${documentReference1Resource.id}/$fileUpload`)
            .send({ resourceType: 'Parameters', parameter: [{ name: 'fileName', valueString: 'never-uploaded.pdf' }] })
            .set(getHeaders());
        expect(resp.status).toBe(200);
        const { contentId } = resp.body;

        // No uploadAsync call this time — the file was never actually PUT to S3.
        resp = await request
            .get(`/4_0_0/DocumentReference/${documentReference1Resource.id}/${contentId}/$fileDownload`)
            .set(getHeaders());
        expect(resp.status).toBe(404);
    });

    test('$fileUpload rejects a caller without DocumentReference write access', async () => {
        const request = await createTestRequest(registerMockClient);

        let resp = await request
            .put(`/4_0_0/DocumentReference/${documentReference1Resource.id}`)
            .send(documentReference1Resource)
            .set(getHeaders());
        expect(resp.status).toBe(201);

        resp = await request
            .post(`/4_0_0/DocumentReference/${documentReference1Resource.id}/$fileUpload`)
            .send({ resourceType: 'Parameters', parameter: [] })
            .set(getHeaders('user/DocumentReference.read access/bwell.*'));
        expect(resp.status).toBe(403);
    });

    test('$fileDownload rejects a caller without DocumentReference read access', async () => {
        const request = await createTestRequest(registerMockClient);

        let resp = await request
            .put(`/4_0_0/DocumentReference/${documentReference1Resource.id}`)
            .send(documentReference1Resource)
            .set(getHeaders());
        expect(resp.status).toBe(201);

        resp = await request
            .post(`/4_0_0/DocumentReference/${documentReference1Resource.id}/$fileUpload`)
            .send({ resourceType: 'Parameters', parameter: [] })
            .set(getHeaders());
        expect(resp.status).toBe(200);
        const { contentId } = resp.body;

        resp = await request
            .get(`/4_0_0/DocumentReference/${documentReference1Resource.id}/${contentId}/$fileDownload`)
            .set(getHeaders('user/Patient.* access/bwell.*'));
        expect(resp.status).toBe(403);
    });

    test('two concurrent $fileUpload calls on the same resource each keep their own content[] entry', async () => {
        const request = await createTestRequest(registerMockClient);

        let resp = await request
            .put(`/4_0_0/DocumentReference/${documentReference1Resource.id}`)
            .send(documentReference1Resource)
            .set(getHeaders());
        expect(resp.status).toBe(201);

        const uploadOnce = (fileName) => request
            .post(`/4_0_0/DocumentReference/${documentReference1Resource.id}/$fileUpload`)
            .send({ resourceType: 'Parameters', parameter: [{ name: 'fileName', valueString: fileName }] })
            .set(getHeaders());

        const [respA, respB] = await Promise.all([
            uploadOnce('concurrent-a.pdf'),
            uploadOnce('concurrent-b.pdf')
        ]);
        expect(respA.status).toBe(200);
        expect(respB.status).toBe(200);
        expect(respA.body.contentId).not.toBe(respB.body.contentId);

        resp = await request
            .get(`/4_0_0/DocumentReference/${documentReference1Resource.id}`)
            .set(getHeaders());
        expect(resp.status).toBe(200);
        // 1 pre-existing + 2 concurrently-added entries — neither concurrent write clobbered the other.
        expect(resp.body.content).toHaveLength(3);
        const ids = resp.body.content.map((c) => c.id);
        expect(ids).toContain(respA.body.contentId);
        expect(ids).toContain(respB.body.contentId);
    });
});
