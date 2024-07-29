const { PostRequestProcessor } = require('../../../utils/postRequestProcessor');
const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getHeaders,
    getTestContainer,
    getRequestId
} = require('../../common');
const documentReferenceData = require('./fixtures/document_reference/document_reference.json');

const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('GridFS history tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('GridFS history works', () => {
        test('history tests', async () => {
            const request = await createTestRequest();
            const container = getTestContainer();
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;

            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/DocumentReference/$merge')
                .send(documentReferenceData)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            // wait for post request processing to finish
            await postRequestProcessor.waitTillDoneAsync({ requestId: getRequestId(resp) });

            resp = await request
                .post('/4_0_0/DocumentReference/$merge')
                .send(documentReferenceData)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ updated: false });

            resp = await request
                .get(`/4_0_0/DocumentReference/_history?id=${resp._body.id}`)
                .set(getHeaders())
                .expect(200);

            expect(resp._body.entry[0].resource.content[0].attachment._file_id).toBeUndefined();

            expect(resp._body.entry[0].resource.content[0].attachment.data).toBeDefined();

            expect(resp._body.entry[0].resource.content[0].attachment.data).toEqual(
                documentReferenceData.content[0].attachment.data
            );
        });

        test('historyById tests', async () => {
            const request = await createTestRequest();
            const container = getTestContainer();
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;

            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/DocumentReference/$merge')
                .send(documentReferenceData)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            // wait for post request processing to finish
            await postRequestProcessor.waitTillDoneAsync({ requestId: getRequestId(resp) });

            resp = await request
                .post('/4_0_0/DocumentReference/$merge')
                .send(documentReferenceData)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ updated: false });

            resp = await request
                .get(`/4_0_0/DocumentReference/${resp._body.id}/_history`)
                .set(getHeaders())
                .expect(200);

            expect(resp._body.entry[0].resource.content[0].attachment._file_id).toBeUndefined();

            expect(resp._body.entry[0].resource.content[0].attachment.data).toBeDefined();

            expect(resp._body.entry[0].resource.content[0].attachment.data).toEqual(
                documentReferenceData.content[0].attachment.data
            );
        });
    });
});
