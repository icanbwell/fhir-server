// test file
const consent1Resource = require('./fixtures/Consent/consent1.json');

// expected
const expectedConsentResources = require('./fixtures/expected/expected_Consent.json');

const {commonBeforeEach, commonAfterEach, getHeaders, createTestRequest} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');

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
            expect(resp).toHaveMergeResponse({created: true});

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Consent back
            resp = await request
                .get('/4_0_0/Consent/?_bundle=1&?source-reference=QuestionnaireResponse/58c79dc2-23e8-40a7-9e9b-1ae1a5385f09')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedConsentResources);
        });
    });
});
