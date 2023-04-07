const {commonBeforeEach, commonAfterEach, createTestRequest, getHeaders} = require('../../common');
const documentReferenceData = require('./fixtures/document_reference/document_reference.json');

describe('GridFS merge tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('GridFS creation tests', () => {
        test('_file_id stored in db works', async () => {
            const request = await createTestRequest();
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/DocumentReference/$merge')
                .send(documentReferenceData)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse(resp._body);
        });
    });
});
