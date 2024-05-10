const { ObjectId } = require('mongodb');
const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { createTestContainer } = require('../../createTestContainer');

const documentReferenceData = require('./fixtures/document_reference/document_reference1.json');

const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('GridFs remove Test', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Document Reference remove Tests', () => {
        test('active in metadata set to false works', async () => {
            const request = await createTestRequest();
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

            const documentReference = await fhirDb.collection(documentReferenceCollection)
                .find({ id: resp._body.id }, { projection: { content: 1 } }).toArray();

            resp = await request
                .delete(`/4_0_0/DocumentReference/${resp._body.id}`)
                .set(getHeaders())
                .expect(204);

            expect(documentReference.length).toEqual(1);

            expect(documentReference[0].content[0].attachment.data).toBeUndefined();

            expect(documentReference[0].content[0].attachment._file_id).toBeDefined();

            const file = await fhirDb.collection('fs.files')
                .find({ _id: new ObjectId(documentReference[0].content[0].attachment._file_id) }).toArray();

            expect(file.length).toEqual(1);

            expect(file[0].metadata.active).toEqual(false);
        });
    });
});
