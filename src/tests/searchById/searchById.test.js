const env = require('var');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

// test file
const compositionResource1 = require('./fixtures/Composition/composition1.json');

// expected
const expectedCompositionResource = require('./fixtures/expected/expectedComposition.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../common');

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
        let resp = await request.post('/4_0_0/Composition/1/$merge?validate=true').send(compositionResource1).set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        // ACT & ASSERT
        resp = await request.get('/4_0_0/Composition/composition1').set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedCompositionResource);
    });

    test('Search By Id Works for Composition when skip class object is disabled', async () => {
        // disable skipClassObjectResources
        let skipClassObjectResources = env.SKIP_CLASS_OBJECT_RESOURCES;
        env.SKIP_CLASS_OBJECT_RESOURCES = "";

        const request = await createTestRequest();
        // ARRANGE
        // add the resources to FHIR server
        let resp = await request.post('/4_0_0/Composition/1/$merge?validate=true').send(compositionResource1).set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        // ACT & ASSERT
        resp = await request.get('/4_0_0/Composition/composition1').set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedCompositionResource);

        env.SKIP_CLASS_OBJECT_RESOURCES = skipClassObjectResources;
    });
});
