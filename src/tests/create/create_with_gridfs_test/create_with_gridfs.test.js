const {commonBeforeEach, commonAfterEach, createTestRequest, getHeaders} = require('../../common');
const documentReference1Data = require('./fixtures/document_reference/document_reference1.json');
const documentReference2Data = require('./fixtures/document_reference/document_reference2.json');

describe('GridFS create tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('GridFS creation', () => {
        test('_file_id stored in db works', async () => {
            const request = await createTestRequest();
            // add the resources to FHIR server
            let response = await request
                .post('/4_0_0/DocumentReference/')
                .send(documentReference1Data)
                .set(getHeaders())
                .expect(201);

            response = await request
                .get(`/${response.headers.location}`)
                .set(getHeaders())
                .expect(200);

            const documentReference = JSON.parse(response.text);

            expect(documentReference.content[0].attachment.data).toBeUndefined();

            expect(documentReference.content[0].attachment._file_id).toBeDefined();
        });

        test('_file_id not stored in db works', async () => {
            const request = await createTestRequest();
            // add the resources to FHIR server
            let response = await request
                .post('/4_0_0/DocumentReference/')
                .send(documentReference2Data)
                .set(getHeaders())
                .expect(201);

            response = await request
                .get(`/${response.headers.location}`)
                .set(getHeaders())
                .expect(200);

            const documentReference = JSON.parse(response.text);

            expect(documentReference.content[0].attachment.data).toBeUndefined();

            expect(documentReference.content[0].attachment._file_id).toBeUndefined();
        });
    });
});
