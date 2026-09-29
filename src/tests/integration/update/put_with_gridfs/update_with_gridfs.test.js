const { ObjectId } = require('mongodb');
const { commonBeforeEach, commonAfterEach, createTestRequest, getHeaders } = require('../../common');
const { createTestContainer } = require('../../createTestContainer');
const documentReferenceData = require('./fixtures/document_reference/document_reference.json');
const documentReferenceWithoutData = require('./fixtures/document_reference/document_reference_without_data.json');
const updatedDocumentReferenceData = require('./fixtures/document_reference/updated_document_reference.json');

const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

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
                .find({ id: resp._body.id }, { projection: { content: 1 } }).toArray();

            expect(originalResource.length).toEqual(1);
            expect(originalResource[0].content.length).toEqual(2);
            expect(originalResource[0].content[0].attachment.data).toBeUndefined();
            expect(originalResource[0].content[0].attachment._file_id).toBeDefined();
            expect(originalResource[0].content[1].attachment.data).toBeUndefined();
            expect(originalResource[0].content[1].attachment._file_id).toBeDefined();

            resp = await request
                .put(`/4_0_0/DocumentReference/${resp._body.id}`)
                .send(updatedDocumentReferenceData)
                .set(getHeaders())
                .expect(200);

            const documentReferenceInResp = resp.body;
            expect(documentReferenceInResp.content.length).toEqual(2);
            expect(documentReferenceInResp.content[0].attachment._file_id).toBeUndefined();
            expect(documentReferenceInResp.content[0].attachment.data).toBeDefined();
            expect(documentReferenceInResp.content[0].attachment.data).toEqual(updatedDocumentReferenceData.content[0].attachment.data);

            expect(documentReferenceInResp.content[1].attachment._file_id).toBeUndefined();
            expect(documentReferenceInResp.content[1].attachment.data).toBeDefined();
            expect(documentReferenceInResp.content[1].attachment.data).toEqual(updatedDocumentReferenceData.content[1].attachment.data);

            const documentReferenceInDb = await fhirDb.collection(documentReferenceCollection)
                .find({ id: documentReferenceInResp.id }, { projection: { content: 1 } }).toArray();

            expect(documentReferenceInDb.length).toEqual(1);
            expect(documentReferenceInDb[0].content.length).toEqual(2);
            expect(documentReferenceInDb[0].content[0].attachment.data).toBeUndefined();
            expect(documentReferenceInDb[0].content[0].attachment._file_id).toBeDefined();
            expect(documentReferenceInDb[0].content[1].attachment.data).toBeUndefined();
            expect(documentReferenceInDb[0].content[1].attachment._file_id).toBeDefined();

            expect(documentReferenceInDb[0].content[0].attachment._file_id).not.toEqual(
                originalResource[0].content[0].attachment._file_id
            );
            expect(documentReferenceInDb[0].content[1].attachment._file_id).toEqual(
                originalResource[0].content[1].attachment._file_id
            );

            const originalFile1 = await fhirDb.collection('fs.files')
                .find({ _id: new ObjectId(originalResource[0].content[0].attachment._file_id) }).toArray();
            expect(originalFile1.length).toEqual(1);
            expect(originalFile1[0].metadata.active).toEqual(false);

            const originalFile2 = await fhirDb.collection('fs.files')
                .find({ _id: new ObjectId(originalResource[0].content[1].attachment._file_id) }).toArray();
            expect(originalFile2.length).toEqual(1);
            expect(originalFile2[0].metadata.active).toEqual(true);

            const newFile1 = await fhirDb.collection('fs.files')
                .find({ _id: new ObjectId(documentReferenceInDb[0].content[0].attachment._file_id) }).toArray();
            expect(newFile1.length).toEqual(1);
            expect(newFile1[0].metadata.active).toEqual(true);
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
                .find({ id: resp._body.id }, { projection: { content: 1 } }).toArray();

            expect(originalResource.length).toEqual(1);
            expect(originalResource[0].content.length).toEqual(2);
            expect(originalResource[0].content[0].attachment.data).toBeUndefined();
            expect(originalResource[0].content[0].attachment._file_id).toBeDefined();
            expect(originalResource[0].content[1].attachment.data).toBeUndefined();
            expect(originalResource[0].content[1].attachment._file_id).toBeDefined();

            resp = await request
                .put(`/4_0_0/DocumentReference/${resp._body.id}`)
                .send(documentReferenceData)
                .set(getHeaders())
                .expect(200);

            const documentReferenceInResp = resp.body;
            expect(documentReferenceInResp.content.length).toEqual(2);
            expect(documentReferenceInResp.content[0].attachment._file_id).toBeUndefined();
            expect(documentReferenceInResp.content[0].attachment.data).toBeDefined();
            expect(documentReferenceInResp.content[0].attachment.data).toEqual(documentReferenceData.content[0].attachment.data);

            expect(documentReferenceInResp.content[1].attachment._file_id).toBeUndefined();
            expect(documentReferenceInResp.content[1].attachment.data).toBeDefined();
            expect(documentReferenceInResp.content[1].attachment.data).toEqual(documentReferenceData.content[1].attachment.data);

            const documentReferenceInDb = await fhirDb.collection(documentReferenceCollection)
                .find({ id: documentReferenceInResp.id }, { projection: { content: 1 } }).toArray();

            expect(documentReferenceInDb.length).toEqual(1);
            expect(documentReferenceInDb[0].content.length).toEqual(2);
            expect(documentReferenceInDb[0].content[0].attachment.data).toBeUndefined();
            expect(documentReferenceInDb[0].content[0].attachment._file_id).toBeDefined();
            expect(documentReferenceInDb[0].content[1].attachment.data).toBeUndefined();
            expect(documentReferenceInDb[0].content[1].attachment._file_id).toBeDefined();

            expect(documentReferenceInDb[0].content[0].attachment._file_id).toEqual(
                originalResource[0].content[0].attachment._file_id
            );
            expect(documentReferenceInDb[0].content[1].attachment._file_id).toEqual(
                originalResource[0].content[1].attachment._file_id
            );

            const originalFile1 = await fhirDb.collection('fs.files')
                .find({ _id: new ObjectId(originalResource[0].content[0].attachment._file_id) }).toArray();
            expect(originalFile1.length).toEqual(1);
            expect(originalFile1[0].metadata.active).toEqual(true);

            const originalFile2 = await fhirDb.collection('fs.files')
                .find({ _id: new ObjectId(originalResource[0].content[1].attachment._file_id) }).toArray();
            expect(originalFile2.length).toEqual(1);
            expect(originalFile2[0].metadata.active).toEqual(true);
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
                .find({ id: resp._body.id }, { projection: { content: 1 } }).toArray();

            expect(originalResource.length).toEqual(1);
            expect(originalResource[0].content.length).toEqual(2);
            expect(originalResource[0].content[0].attachment.data).toBeUndefined();
            expect(originalResource[0].content[0].attachment._file_id).toBeDefined();
            expect(originalResource[0].content[1].attachment.data).toBeUndefined();
            expect(originalResource[0].content[1].attachment._file_id).toBeDefined();

            resp = await request
                .put(`/4_0_0/DocumentReference/${resp._body.id}`)
                .send(documentReferenceWithoutData)
                .set(getHeaders())
                .expect(200);

            const documentReferenceInResp = resp.body;
            expect(documentReferenceInResp.content.length).toEqual(1);
            expect(documentReferenceInResp.content[0].attachment._file_id).toBeUndefined();
            expect(documentReferenceInResp.content[0].attachment.data).toBeUndefined();

            const documentReferenceInDb = await fhirDb.collection(documentReferenceCollection)
                .find({ id: resp._body.id }, { projection: { content: 1 } }).toArray();

            expect(documentReferenceInDb.length).toEqual(1);
            expect(documentReferenceInDb[0].content.length).toEqual(1);
            expect(documentReferenceInDb[0].content[0].attachment.data).toBeUndefined();
            expect(documentReferenceInDb[0].content[0].attachment._file_id).toBeUndefined();

            const originalFile1 = await fhirDb.collection('fs.files')
                .find({ _id: new ObjectId(originalResource[0].content[0].attachment._file_id) }).toArray();
            expect(originalFile1.length).toEqual(1);
            expect(originalFile1[0].metadata.active).toEqual(false);

            const originalFile2 = await fhirDb.collection('fs.files')
                .find({ _id: new ObjectId(originalResource[0].content[1].attachment._file_id) }).toArray();
            expect(originalFile2.length).toEqual(1);
            expect(originalFile2[0].metadata.active).toEqual(false);
        });
    });
});
