const {commonBeforeEach, commonAfterEach, createTestRequest, getHeaders} = require('../../common');
const documentReferenceData = require('./fixtures/document_reference/document_reference.json');

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
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/DocumentReference/$merge')
                .send(documentReferenceData)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/DocumentReference/$merge')
                .send(documentReferenceData)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ updated: true });

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
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/DocumentReference/$merge')
                .send(documentReferenceData)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/DocumentReference/$merge')
                .send(documentReferenceData)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ updated: true });

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
