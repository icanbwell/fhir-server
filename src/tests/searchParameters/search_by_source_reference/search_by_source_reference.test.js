// test file
const consent1Resource = require('./fixtures/Consent/consent1.json');
const consent2Resource = require('./fixtures/Consent/consent2.json');

// expected
const expectedConsentResources = require('./fixtures/expected/expected_Consent.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Consent Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Consent search_by_source_reference Tests', () => {
        test('search_by_source_reference works', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Consent/1/$merge?validate=true')
                .send(consent1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Consent/1/$merge?validate=true')
                .send(consent2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Consent/?_bundle=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(2);

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Consent back
            resp = await request
                .get('/4_0_0/Consent/?_bundle=1&source-reference=QuestionnaireResponse/fdf49831-d3c0-4a89-9459-e96c6c3beb0f&_debug=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedConsentResources);
        });
    });
});
