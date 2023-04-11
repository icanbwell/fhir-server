const {commonBeforeEach, commonAfterEach, createTestRequest, getHeaders} = require('../../common');
const documentReferenceData = require('./fixtures/document_reference/document_reference.json');
const updatedDocumentReferenceData = require('./fixtures/document_reference/updated_document_reference.json');

describe('GridFS update tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('GridFS updation', () => {
        test("_file_id doesn't in db works", async () => {
            const request = await createTestRequest();
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/DocumentReference/$merge')
                .send(documentReferenceData)
                .set(getHeaders())
                .expect(200);

            resp = await request
                .put(`/4_0_0/DocumentReference/${resp.id}`)
                .send(updatedDocumentReferenceData)
                .set(getHeaders())
                .expect(201);

            expect(resp._body.content[0].attachment.data).toBeUndefined();

            expect(resp._body.content[0].attachment._file_id).toBeDefined();
        });
    });
});
