const {commonBeforeEach, commonAfterEach, createTestRequest, getHeaders} = require('../../common');
// const { createTestContainer } = require('../../createTestContainer');
const { TestMongoDatabaseManager } = require('../../testMongoDatabaseManager');

const documentReferenceData = require('./fixtures/document_reference/document_reference.json');
const updatedDocumentReferenceData = require('./fixtures/document_reference/updated_document_reference.json');
const expectedCreateResponse = require('./fixtures/expected/create_response.json');
const expectedUpdateResponse = require('./fixtures/expected/update_response.json');


describe('GridFS merge tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('GridFS creation tests', () => {
        test('_file_id stored in db works', async () => {
            const base_version = '4_0_0';
            const request = await createTestRequest();
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/DocumentReference/$merge')
                .send(documentReferenceData)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse(expectedCreateResponse);

            // const container = createTestContainer();

            /**
             * @type {MongoDatabaseManager}
             */
            // const mongoDatabaseManager = container.mongoDatabaseManager;
            const mongoDatabaseManager = new TestMongoDatabaseManager();
            /**
             * mongo connection
             * @type {import('mongodb').Db}
             */
            const fhirDb = await mongoDatabaseManager.getClientDbAsync();

            const documentReferenceCollection = `DocumentReference_${base_version}`;

            const documentReference = await fhirDb.collection(documentReferenceCollection)
                .find({ id: resp._body.id }, { projection: { content: 1 }}).toArray();

            expect(documentReference.length).toEqual(1);

            expect(documentReference[0].content[0].attachment.data).toBeUndefined();

            expect(documentReference[0].content[0].attachment._file_id).toBeDefined();

            resp = await request
                .post('/4_0_0/DocumentReference/$merge')
                .send(updatedDocumentReferenceData)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse(expectedUpdateResponse);
        });
    });
});
