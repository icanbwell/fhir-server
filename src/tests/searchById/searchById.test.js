const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');

// test file
const compositionResource1 = require('./fixtures/Composition/composition1.json');
const compositionResource2 = require('./fixtures/Composition/composition2.json');

// expected
const expectedCompositionResource = require('./fixtures/expected/expectedComposition.json');
const expectedCompositionResourceWithHashReference = require('./fixtures/expected/expectedCompositionHashRef.json');
const expectedCompositionResourceWithGlobalId = require('./fixtures/expected/expectedCompositionGlobalId.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../common');
const { FhirResourceSerializer } = require('../../fhir/fhirResourceSerializer');

describe('Search By Id Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });
    test('Search By Id Works for Composition when skip class object is configured', async () => {
        const request = await createTestRequest();
        // ARRANGE
        // add the resources to FHIR server
        let resp = await request
            .post('/4_0_0/Composition/1/$merge?validate=true')
            .send(compositionResource1)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Composition/1/$merge?validate=true')
            .send(compositionResource2)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        // ACT & ASSERT
        resp = await request.get('/4_0_0/Composition/composition1').set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedCompositionResource);

        // enrichers works for get by id
        resp = await request
            .get('/4_0_0/Composition/composition2?_hash_references=true&_metaUuid=true')
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedCompositionResourceWithHashReference);

        resp = await request.get('/4_0_0/Composition/composition2').set({ ...getHeaders(), prefer: 'global_id=true' });
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedCompositionResourceWithGlobalId);
    });

    test('Search By Id Works for Composition when skip class object is disabled', async () => {
        // disable skipClassObjectResources
        let skipClassObjectResources = process.env.SKIP_CLASS_OBJECT_RESOURCES;
        process.env.SKIP_CLASS_OBJECT_RESOURCES = '';

        const request = await createTestRequest();
        // ARRANGE
        // add the resources to FHIR server
        let resp = await request
            .post('/4_0_0/Composition/1/$merge?validate=true')
            .send(compositionResource1)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Composition/1/$merge?validate=true')
            .send(compositionResource2)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        // ACT & ASSERT
        resp = await request.get('/4_0_0/Composition/composition1').set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedCompositionResource);

        // enrichers works for get by id
        resp = await request
            .get('/4_0_0/Composition/composition2?_hash_references=true&_metaUuid=true')
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedCompositionResourceWithHashReference);

        resp = await request.get('/4_0_0/Composition/composition2').set({ ...getHeaders(), prefer: 'global_id=true' });
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedCompositionResourceWithGlobalId);

        process.env.SKIP_CLASS_OBJECT_RESOURCES = skipClassObjectResources;
    });

    test('Search By Id Works for Composition when fast serilizer is configured', async () => {
        // enable FastSerializerInSearchById
        let enableFastSerializerInSearchById = process.env.ENABLE_FAST_SERIALIZER_IN_SEARCH_BY_ID;
        process.env.ENABLE_FAST_SERIALIZER_IN_SEARCH_BY_ID = '1';

        const serializerSpy = jest.spyOn(FhirResourceSerializer, 'serialize');

        const request = await createTestRequest();
        // ARRANGE
        // add the resources to FHIR server
        let resp = await request
            .post('/4_0_0/Composition/1/$merge?validate=true')
            .send(compositionResource1)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Composition/1/$merge?validate=true')
            .send(compositionResource2)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        // ACT & ASSERT
        resp = await request.get('/4_0_0/Composition/composition1').set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedCompositionResource);

        // enrichers works for get by id
        resp = await request
            .get('/4_0_0/Composition/composition2?_hash_references=true&_metaUuid=true')
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedCompositionResourceWithHashReference);

        resp = await request.get('/4_0_0/Composition/composition2').set({ ...getHeaders(), prefer: 'global_id=true' });
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedCompositionResourceWithGlobalId);

        expect(serializerSpy).toHaveBeenCalled()

        process.env.ENABLE_FAST_SERIALIZER_IN_SEARCH_BY_ID = enableFastSerializerInSearchById;
    });
});
