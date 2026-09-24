const documentReference1Resource = require('./fixtures/DocumentReference/documentReference1.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('DocumentReference $fileUpload / $fileDownload — disabled by default', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('$fileUpload returns 404 when enableDocumentReferenceFileOperations is off', async () => {
        const request = await createTestRequest();

        let resp = await request
            .put(`/4_0_0/DocumentReference/${documentReference1Resource.id}`)
            .send(documentReference1Resource)
            .set(getHeaders());
        expect(resp.status).toBe(201);

        resp = await request
            .post(`/4_0_0/DocumentReference/${documentReference1Resource.id}/$fileUpload`)
            .send({ resourceType: 'Parameters', parameter: [{ name: 'fileName', valueString: 'report.pdf' }] })
            .set(getHeaders());

        expect(resp.status).toBe(404);
    });

    test('$fileDownload returns 404 when enableDocumentReferenceFileOperations is off', async () => {
        const request = await createTestRequest();

        let resp = await request
            .put(`/4_0_0/DocumentReference/${documentReference1Resource.id}`)
            .send(documentReference1Resource)
            .set(getHeaders());
        expect(resp.status).toBe(201);

        resp = await request
            .get(`/4_0_0/DocumentReference/${documentReference1Resource.id}/some-content-id/$fileDownload`)
            .set(getHeaders());

        expect(resp.status).toBe(404);
    });

    test('$fileUpload returns 404, not 403, for a caller without write access when disabled', async () => {
        const request = await createTestRequest();

        let resp = await request
            .put(`/4_0_0/DocumentReference/${documentReference1Resource.id}`)
            .send(documentReference1Resource)
            .set(getHeaders());
        expect(resp.status).toBe(201);

        resp = await request
            .post(`/4_0_0/DocumentReference/${documentReference1Resource.id}/$fileUpload`)
            .send({ resourceType: 'Parameters', parameter: [] })
            .set(getHeaders('user/DocumentReference.read access/bwell.*'));

        expect(resp.status).toBe(404);
    });

    test('$fileDownload returns 404, not 403, for a caller without read access when disabled', async () => {
        const request = await createTestRequest();

        let resp = await request
            .put(`/4_0_0/DocumentReference/${documentReference1Resource.id}`)
            .send(documentReference1Resource)
            .set(getHeaders());
        expect(resp.status).toBe(201);

        resp = await request
            .get(`/4_0_0/DocumentReference/${documentReference1Resource.id}/some-content-id/$fileDownload`)
            .set(getHeaders('user/Patient.* access/bwell.*'));

        expect(resp.status).toBe(404);
    });
});
