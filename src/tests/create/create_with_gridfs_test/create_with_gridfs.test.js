const {commonBeforeEach, commonAfterEach, createTestRequest, getHeaders} = require('../../common');
const { createTestContainer } = require('../../createTestContainer');
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
            const base_version = '4_0_0';
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

            const documentReferenceData = JSON.parse(response.text);

            expect(documentReferenceData.content[0].attachment._file_id).toBeUndefined();

            expect(documentReferenceData.content[0].attachment.data).toBeDefined();

            expect(documentReferenceData.content[0].attachment.data).toEqual(documentReference1Data.content[0].attachment.data);

            const container = createTestContainer();

            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            /**
             * mongo connection
             * @type {import('mongodb').Db}
             */
            const fhirDb = await mongoDatabaseManager.getClientDbAsync();

            const documentReferenceCollection = `DocumentReference_${base_version}`;

            const documentReference = await fhirDb.collection(documentReferenceCollection)
                .find({ id: documentReferenceData.id }, { projection: { content: 1 }}).toArray();

            expect(documentReference.length).toEqual(1);

            expect(documentReference[0].content[0].attachment.data).toBeUndefined();

            expect(documentReference[0].content[0].attachment._file_id).toBeDefined();
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

            const documentReferenceData = JSON.parse(response.text);

            expect(documentReferenceData.content[0].attachment._file_id).toBeUndefined();

            expect(documentReferenceData.content[0].attachment.data).toBeUndefined();

            const base_version = '4_0_0';
            const container = createTestContainer();

            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            /**
             * mongo connection
             * @type {import('mongodb').Db}
             */
            const fhirDb = await mongoDatabaseManager.getClientDbAsync();

            const documentReferenceCollection = `DocumentReference_${base_version}`;

            const documentReference = await fhirDb.collection(documentReferenceCollection)
                .find({ id: documentReferenceData.id }, { projection: { content: 1 }}).toArray();

            expect(documentReference.length).toEqual(1);

            expect(documentReference[0].content[0].attachment.data).toBeUndefined();

            expect(documentReference[0].content[0].attachment._file_id).toBeUndefined();
        });
    });
});
