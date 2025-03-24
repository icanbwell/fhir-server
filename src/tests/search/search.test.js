const env = require('var');
const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');

// test file
const compositionResource1 = require('./fixtures/Composition/composition1.json');
const compositionResource2 = require('./fixtures/Composition/composition2.json');

// expected
const expectedCompositionResource = require('./fixtures/expected/expectedComposition.json');
const expectedCompositionResourceWithHashReference = require('./fixtures/expected/expectedCompositionHashRef.json');
const expectedCompositionResourceWithGlobalId = require('./fixtures/expected/expectedCompositionGlobalId.json');
const expectedCompositionResourceWithElementsParam = require('./fixtures/expected/expectedCompositionWithElementsParam.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../common');
const { FhirResourceSerializer } = require('../../fhir/fhirResourceSerializer');

describe('Search list Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });
    test('Search list Works for Composition when skip class object is configured', async () => {
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
        resp = await request.get('/4_0_0/Composition').set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedCompositionResource);

        resp = await request.get('/4_0_0/Composition?_elements=author,id,subject').set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedCompositionResourceWithElementsParam);

        // enrichers works for get list
        resp = await request
            .get('/4_0_0/Composition?_hash_references=true&_metaUuid=true')
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedCompositionResourceWithHashReference);

        resp = await request.get('/4_0_0/Composition').set({ ...getHeaders(), prefer: 'global_id=true' });
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedCompositionResourceWithGlobalId);
    });

    test('Search list Works for Composition when skip class object is disabled', async () => {
        // disable skipClassObjectResources
        let skipClassObjectResources = env.SKIP_CLASS_OBJECT_RESOURCES_IN_LIST;
        env.SKIP_CLASS_OBJECT_RESOURCES_IN_LIST = '';

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
        resp = await request.get('/4_0_0/Composition').set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedCompositionResource);

        resp = await request.get('/4_0_0/Composition?_elements=author,id,subject').set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedCompositionResourceWithElementsParam);

        // enrichers works for get list
        resp = await request
            .get('/4_0_0/Composition?_hash_references=true&_metaUuid=true')
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedCompositionResourceWithHashReference);

        resp = await request.get('/4_0_0/Composition').set({ ...getHeaders(), prefer: 'global_id=true' });
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedCompositionResourceWithGlobalId);

        env.SKIP_CLASS_OBJECT_RESOURCES_IN_LIST = skipClassObjectResources;
    });

    test('Search list Works for Composition when fast serializer is configured', async () => {
        // enable FastSerializerInSearch
        let enableFastSerializerInSearch = env.ENABLE_FAST_SERIALIZER_IN_SEARCH;
        env.ENABLE_FAST_SERIALIZER_IN_SEARCH = '1';
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
        resp = await request.get('/4_0_0/Composition').set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedCompositionResource);

        resp = await request.get('/4_0_0/Composition?_elements=author,id,subject').set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedCompositionResourceWithElementsParam);

        // enrichers works for get list
        resp = await request
            .get('/4_0_0/Composition?_hash_references=true&_metaUuid=true')
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedCompositionResourceWithHashReference);

        resp = await request.get('/4_0_0/Composition').set({ ...getHeaders(), prefer: 'global_id=true' });
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedCompositionResourceWithGlobalId);

        expect(serializerSpy).toHaveBeenCalled()
        env.ENABLE_FAST_SERIALIZER_IN_SEARCH = enableFastSerializerInSearch;
    });
});
