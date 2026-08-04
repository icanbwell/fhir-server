const { BaseSerializer } = require('../../../fhir/writeSerializers/4_0_0/customSerializers');
const { commonBeforeEach, commonAfterEach, createTestRequest, getHeaders } = require('../../common');
const { createTestContainer } = require('../../createTestContainer');

const documentReference1Data = require('./fixtures/document_reference/document_reference1.json');
const documentReference2Data = require('./fixtures/document_reference/document_reference2.json');
const documentReferenceMaliciousFileIdData = require('./fixtures/document_reference/document_reference_malicious_file_id.json');
const updatedDocumentReferenceData = require('./fixtures/document_reference/updated_document_reference.json');
const expectedCreateResponse = require('./fixtures/expected/create_response.json');
const expectedUpdateResponse = require('./fixtures/expected/update_response.json');

const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');

describe('GridFS merge tests (Fast Merge Serializer)', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('GridFS creation tests', () => {
        test('_file_id stored in db works', async () => {
            const writeSerializerSpy = jest.spyOn(BaseSerializer.prototype, 'writeSerialize');
            const base_version = '4_0_0';
            const request = await createTestRequest();
            // add the resources to FHIR server
            const resp = await request
                .post('/4_0_0/DocumentReference/$merge')
                .send(documentReference1Data)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse(expectedCreateResponse);

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
                .find({ id: resp._body.id }, { projection: { content: 1 } }).toArray();

            expect(documentReference.length).toEqual(1);

            expect(documentReference[0].content.length).toEqual(1);

            expect(documentReference[0].content[0].attachment.data).toBeUndefined();

            expect(documentReference[0].content[0].attachment._file_id).toBeDefined();
            expect(writeSerializerSpy).toHaveBeenCalled();
        });

        test('_file_id not stored in db works', async () => {
            const writeSerializerSpy = jest.spyOn(BaseSerializer.prototype, 'writeSerialize');
            const base_version = '4_0_0';
            const request = await createTestRequest();
            // add the resources to FHIR server
            const resp = await request
                .post('/4_0_0/DocumentReference/$merge')
                .send(documentReference2Data)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse(expectedCreateResponse);

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
                .find({ id: resp._body.id }, { projection: { content: 1 } }).toArray();

            expect(documentReference.length).toEqual(1);

            expect(documentReference[0].content.length).toEqual(1);

            expect(documentReference[0].content[0].attachment.data).toBeUndefined();

            expect(documentReference[0].content[0].attachment._file_id).toBeUndefined();
            expect(writeSerializerSpy).toHaveBeenCalled();
        });

        // DCON-4806: a client-supplied _file_id (with no actual `data` uploaded) must never
        // reach the database. _file_id is only ever meant to be set by
        // DatabaseAttachmentManager itself, after it uploads `data` to GridFS -- otherwise a
        // caller could claim an arbitrary GridFS file id (e.g. belonging to another
        // resource/tenant) and have it served back as this resource's attachment on a later
        // read.
        test('client-supplied _file_id is stripped and never persisted', async () => {
            const writeSerializerSpy = jest.spyOn(BaseSerializer.prototype, 'writeSerialize');
            const base_version = '4_0_0';
            const request = await createTestRequest();
            // attacker attempts to plant a foreign _file_id directly, with no data upload
            const resp = await request
                .post('/4_0_0/DocumentReference/$merge')
                .send(documentReferenceMaliciousFileIdData)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse(expectedCreateResponse);

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
                .find({ id: resp._body.id }, { projection: { content: 1 } }).toArray();

            expect(documentReference.length).toEqual(1);

            expect(documentReference[0].content.length).toEqual(1);

            expect(documentReference[0].content[0].attachment.data).toBeUndefined();

            // the attacker-chosen value must be gone entirely, not merely unused
            expect(documentReference[0].content[0].attachment._file_id).toBeUndefined();
            expect(documentReference[0].content[0].attachment._file_id).not.toBe('attacker-chosen-gridfs-id');
            expect(writeSerializerSpy).toHaveBeenCalled();
        });

        test('same data update doesn\'t work', async () => {
            const writeSerializerSpy = jest.spyOn(BaseSerializer.prototype, 'writeSerialize');
            const base_version = '4_0_0';
            const request = await createTestRequest();
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/DocumentReference/$merge')
                .send(documentReference1Data)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse(expectedCreateResponse);

            resp = await request
                .post('/4_0_0/DocumentReference/$merge')
                .send(documentReference1Data)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ updated: false });

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
                .find({ id: resp._body.id }, { projection: { content: 1 } }).toArray();

            expect(documentReference.length).toEqual(1);

            expect(documentReference[0].content.length).toEqual(1);

            expect(documentReference[0].content[0].attachment.data).toBeUndefined();

            expect(documentReference[0].content[0].attachment._file_id).toBeDefined();
            expect(writeSerializerSpy).toHaveBeenCalled();
        });

        test('different data update work', async () => {
            const writeSerializerSpy = jest.spyOn(BaseSerializer.prototype, 'writeSerialize');
            const base_version = '4_0_0';
            const request = await createTestRequest();
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/DocumentReference/$merge')
                .send(documentReference1Data)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse(expectedCreateResponse);

            resp = await request
                .post('/4_0_0/DocumentReference/$merge')
                .send(updatedDocumentReferenceData)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse(expectedUpdateResponse);

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
                .find({ id: resp._body.id }, { projection: { content: 1 } }).toArray();

            expect(documentReference.length).toEqual(1);

            expect(documentReference[0].content.length).toEqual(2);

            expect(documentReference[0].content[0].attachment.data).toBeUndefined();

            expect(documentReference[0].content[0].attachment._file_id).toBeDefined();

            expect(documentReference[0].content[1].attachment.data).toBeUndefined();

            expect(documentReference[0].content[1].attachment._file_id).toBeDefined();
            expect(writeSerializerSpy).toHaveBeenCalled();
        });
    });
});
