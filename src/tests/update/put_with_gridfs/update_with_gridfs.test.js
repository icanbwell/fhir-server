const { ObjectId } = require('mongodb');
const {commonBeforeEach, commonAfterEach, createTestRequest, getHeaders} = require('../../common');
const { createTestContainer } = require('../../createTestContainer');
const documentReferenceData = require('./fixtures/document_reference/document_reference.json');
const documentReferenceWithoutData = require('./fixtures/document_reference/document_reference_without_data.json');
const updatedDocumentReferenceData = require('./fixtures/document_reference/updated_document_reference.json');

describe('GridFS update tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('GridFS updation', () => {
        test("_file_id doesn't change in db", async () => {
            const request = await createTestRequest();
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/DocumentReference/$merge')
                .send(documentReferenceData)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

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

            const originalResource = await fhirDb.collection(documentReferenceCollection)
                .find({ id: resp._body.id }, { projection: { content: 1 }}).toArray();

            expect(originalResource.length).toEqual(1);

            resp = await request
                .put(`/4_0_0/DocumentReference/${resp._body.id}`)
                .send(updatedDocumentReferenceData)
                .set(getHeaders())
                .expect(200);

            expect(resp._body.content[0].attachment._file_id).toBeUndefined();

            expect(resp._body.content[0].attachment.data).toBeDefined();

            expect(resp._body.content[0].attachment.data).toEqual(updatedDocumentReferenceData.content[0].attachment.data);

            const documentReference = await fhirDb.collection(documentReferenceCollection)
                .find({ id: resp._body.id }, { projection: { content: 1 }}).toArray();

            expect(documentReference.length).toEqual(1);

            expect(documentReference[0].content[0].attachment.data).toBeUndefined();

            expect(documentReference[0].content[0].attachment._file_id).toBeDefined();

            const originalFile = await fhirDb.collection('fs.files')
                .find({ _id: new ObjectId(originalResource[0].content[0].attachment._file_id) }).toArray();

            expect(originalFile.length).toEqual(1);

            expect(originalFile[0].metadata.active).toEqual(false);
        });

        test("update with same data doesn't delete file", async () => {
            const request = await createTestRequest();
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/DocumentReference/$merge')
                .send(documentReferenceData)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

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

            const originalResource = await fhirDb.collection(documentReferenceCollection)
                .find({ id: resp._body.id }, { projection: { content: 1 }}).toArray();

            expect(originalResource.length).toEqual(1);

            resp = await request
                .put(`/4_0_0/DocumentReference/${resp._body.id}`)
                .send(documentReferenceData)
                .set(getHeaders())
                .expect(200);

            expect(resp._body.content[0].attachment._file_id).toBeUndefined();

            expect(resp._body.content[0].attachment.data).toBeDefined();

            expect(resp._body.content[0].attachment.data).toEqual(documentReferenceData.content[0].attachment.data);

            const documentReference = await fhirDb.collection(documentReferenceCollection)
                .find({ id: resp._body.id }, { projection: { content: 1 }}).toArray();

            expect(documentReference.length).toEqual(1);

            expect(documentReference[0].content[0].attachment.data).toBeUndefined();

            expect(documentReference[0].content[0].attachment._file_id).toBeDefined();

            const originalFile = await fhirDb.collection('fs.files')
                .find({ _id: new ObjectId(originalResource[0].content[0].attachment._file_id) }).toArray();

            expect(originalFile.length).toEqual(1);

            expect(originalFile[0].metadata.active).toEqual(true);
        });

        test('Removal of data works', async () => {
            const request = await createTestRequest();
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/DocumentReference/$merge')
                .send(documentReferenceData)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

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

            const originalResource = await fhirDb.collection(documentReferenceCollection)
                .find({ id: resp._body.id }, { projection: { content: 1 }}).toArray();

            expect(originalResource.length).toEqual(1);

            resp = await request
                .put(`/4_0_0/DocumentReference/${resp._body.id}`)
                .send(documentReferenceWithoutData)
                .set(getHeaders())
                .expect(200);

            expect(resp._body.content[0].attachment._file_id).toBeUndefined();

            expect(resp._body.content[0].attachment.data).toBeUndefined();

            const documentReference = await fhirDb.collection(documentReferenceCollection)
                .find({ id: resp._body.id }, { projection: { content: 1 }}).toArray();

            expect(documentReference.length).toEqual(1);

            expect(documentReference[0].content[0].attachment.data).toBeUndefined();

            expect(documentReference[0].content[0].attachment._file_id).toBeUndefined();

            const originalFile = await fhirDb.collection('fs.files')
                .find({ _id: new ObjectId(originalResource[0].content[0].attachment._file_id) }).toArray();

            expect(originalFile.length).toEqual(1);

            expect(originalFile[0].metadata.active).toEqual(false);
        });
    });
});
