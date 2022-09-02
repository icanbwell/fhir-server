const explanationOfBenefitBundleResource = require('./fixtures/explanation_of_benefits/explanation_of_benefits.json');
const expectedExplanationOfBenefitBundleResource = require('./fixtures/expected/expected_explanation_of_benefits.json');
const expectedMergeResponse = require('./fixtures/expected/expected_merge_response.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const {describe, beforeEach, afterEach} = require('@jest/globals');
const {expectResponse, expectResourceCount} = require('../../fhirAsserts');

describe('Claim Merge Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Claim Merge Bundles', () => {
        test('Claims with one bad record merge properly', async () => {
            const request = await createTestRequest();
            let resp = await request
                .get('/4_0_0/ExplanationOfBenefit')
                .set(getHeaders());
            expectResourceCount(resp, 0);

            resp = await request
                .post('/4_0_0/ExplanationOfBenefit/1/$merge')
                .send(explanationOfBenefitBundleResource)
                .set(getHeaders());
            expectResponse(resp, expectedMergeResponse);

            resp = await request
                .get('/4_0_0/ExplanationOfBenefit')
                .set(getHeaders());
            expectResponse(resp, expectedExplanationOfBenefitBundleResource);
        });
    });
});
