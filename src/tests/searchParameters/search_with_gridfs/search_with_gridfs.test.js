const { commonBeforeEach, commonAfterEach, createTestRequest, getHeaders } = require('../../common');
const documentReferenceData = require('./fixtures/document_reference/document_reference1.json');

const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');
const { FhirResourceSerializer } = require('../../../fhir/fhirResourceSerializer');

describe('GridFS search tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('GridFS searchById works', () => {
        test('attachment.data is present', async () => {
            const request = await createTestRequest();
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/DocumentReference/$merge')
                .send(documentReferenceData)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get(`/4_0_0/DocumentReference/${resp._body.id}`)
                .set(getHeaders())
                .expect(200);

            expect(resp._body.content[0].attachment._file_id).toBeUndefined();

            expect(resp._body.content[0].attachment.data).toBeDefined();

            expect(resp._body.content[0].attachment.data).toEqual(documentReferenceData.content[0].attachment.data);
        });

        test('attachment.data is present with fast serialization', async () => {
            // enable FastSerializerInSearchById
            let enableFastSerializerInSearchById = process.env.ENABLE_FAST_SERIALIZER_IN_SEARCH_BY_ID;
            process.env.ENABLE_FAST_SERIALIZER_IN_SEARCH_BY_ID = '1';
            const serializerSpy = jest.spyOn(FhirResourceSerializer, 'serialize');

            const request = await createTestRequest();
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/DocumentReference/$merge')
                .send(documentReferenceData)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get(`/4_0_0/DocumentReference/${resp._body.id}`)
                .set(getHeaders())
                .expect(200);

            expect(resp._body.content[0].attachment._file_id).toBeUndefined();

            expect(resp._body.content[0].attachment.data).toBeDefined();

            expect(resp._body.content[0].attachment.data).toEqual(documentReferenceData.content[0].attachment.data);

            expect(serializerSpy).toHaveBeenCalled()
            process.env.ENABLE_FAST_SERIALIZER_IN_SEARCH_BY_ID = enableFastSerializerInSearchById;
        });

        test('search streaming works', async () => {
            const request = await createTestRequest();
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/DocumentReference/$merge')
                .send(documentReferenceData)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/DocumentReference/')
                .set(getHeaders())
                .expect(200);

            expect(resp._body[0].content[0].attachment._file_id).toBeUndefined();

            expect(resp._body[0].content[0].attachment.data).toBeDefined();

            expect(resp._body[0].content[0].attachment.data).toEqual(documentReferenceData.content[0].attachment.data);
        });

        test('search streaming works with _elements and fast serialization', async () => {
            // enable FastSerializerInSearch
            let enableFastSerializerInSearch = process.env.ENABLE_FAST_SERIALIZER_IN_SEARCH;
            process.env.ENABLE_FAST_SERIALIZER_IN_SEARCH = '1';
            const serializerSpy = jest.spyOn(FhirResourceSerializer, 'serialize');

            const request = await createTestRequest();
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/DocumentReference/$merge')
                .send(documentReferenceData)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/DocumentReference/?_elements=content')
                .set(getHeaders())
                .expect(200);

            expect(resp._body[0].content[0].attachment._file_id).toBeUndefined();

            expect(resp._body[0].content[0].attachment.data).toBeDefined();

            expect(resp._body[0].content[0].attachment.data).toEqual(documentReferenceData.content[0].attachment.data);

            expect(serializerSpy).toHaveBeenCalled()
            process.env.ENABLE_FAST_SERIALIZER_IN_SEARCH = enableFastSerializerInSearch;
        });

        test('search searchByVersionId works', async () => {
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

            expect(resp).toHaveMergeResponse({ updated: false });

            resp = await request
                .get(`/4_0_0/DocumentReference/${resp._body.id}/_history/1`)
                .set(getHeaders())
                .expect(200);

            expect(resp._body.content[0].attachment._file_id).toBeUndefined();

            expect(resp._body.content[0].attachment.data).toBeDefined();

            expect(resp._body.content[0].attachment.data).toEqual(documentReferenceData.content[0].attachment.data);
        });

        test('search expand works', async () => {
            const request = await createTestRequest();
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/DocumentReference/$merge')
                .send(documentReferenceData)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get(`/4_0_0/DocumentReference/${resp._body.id}/$expand`)
                .set(getHeaders())
                .expect(200);

            expect(resp._body.content[0].attachment._file_id).toBeUndefined();

            expect(resp._body.content[0].attachment.data).toBeDefined();

            expect(resp._body.content[0].attachment.data).toEqual(documentReferenceData.content[0].attachment.data);
        });
    });
});
