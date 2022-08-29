const explanationOfBenefitBundleResource = require('./fixtures/explanation_of_benefits.json');
const expectedExplanationOfBenefitBundleResource = require('./fixtures/expected_explanation_of_benefits.json');
const expectedExplanationOfBenefitOperationOutcomeBundleResource = require('./fixtures/expected_explanation_of_benefits_operation_outcome_bundle.json');

const {commonBeforeEach, commonAfterEach, getHeaders, createTestRequest, getHeadersPreferOperationOutcome} = require('../../common');
const {describe, beforeEach, afterEach} = require('@jest/globals');
const {assertResourceCount, assertMerge, assertResponse} = require('../../fhirAsserts');

describe('Claim Merge Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Claim Merge Bundles', () => {
        test('Complex Claims with merge properly', async () => {
            const request = await createTestRequest();
            await request
                .get('/4_0_0/ExplanationOfBenefit')
                .set(getHeaders())
                .expect(assertResourceCount(0));

            await request
                .post('/4_0_0/ExplanationOfBenefit/1/$merge')
                .send(explanationOfBenefitBundleResource)
                .set(getHeaders())
                .expect(assertMerge([{created: true}, {updated: true}]));

            await request
                .get('/4_0_0/ExplanationOfBenefit')
                .set(getHeaders())
                .expect(assertResourceCount(1))
                .expect(assertResponse(expectedExplanationOfBenefitBundleResource));
        });
        test('Complex Claims with merge properly (with Prefer header)', async () => {
            const request = await createTestRequest();
            await request
                .get('/4_0_0/ExplanationOfBenefit')
                .set(getHeaders())
                .expect(assertResourceCount(0));

            await request
                .post('/4_0_0/ExplanationOfBenefit/1/$merge')
                .send(explanationOfBenefitBundleResource)
                .set(getHeadersPreferOperationOutcome())
                .expect(assertResponse(expectedExplanationOfBenefitOperationOutcomeBundleResource));

            await request
                .get('/4_0_0/ExplanationOfBenefit')
                .set(getHeaders())
                .expect(assertResourceCount(1))
                .expect(assertResponse(expectedExplanationOfBenefitBundleResource));
        });
    });
});
