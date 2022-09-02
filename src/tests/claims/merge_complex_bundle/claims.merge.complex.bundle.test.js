const explanationOfBenefitBundleResource = require('./fixtures/explanation_of_benefits.json');
const expectedExplanationOfBenefitBundleResource = require('./fixtures/expected_explanation_of_benefits.json');
const expectedExplanationOfBenefitOperationOutcomeBundleResource = require('./fixtures/expected_explanation_of_benefits_operation_outcome_bundle.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getHeadersPreferOperationOutcome,
} = require('../../common');
const {describe, beforeEach, afterEach} = require('@jest/globals');


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
            let resp = await request
                .get('/4_0_0/ExplanationOfBenefit')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/ExplanationOfBenefit/1/$merge')
                .send(explanationOfBenefitBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{created: true}, {updated: true}]);

            resp = await request
                .get('/4_0_0/ExplanationOfBenefit')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedExplanationOfBenefitBundleResource);
        });
        test('Complex Claims with merge properly (with Prefer header)', async () => {
            const request = await createTestRequest();
            let resp = await request
                .get('/4_0_0/ExplanationOfBenefit')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/ExplanationOfBenefit/1/$merge')
                .send(explanationOfBenefitBundleResource)
                .set(getHeadersPreferOperationOutcome());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedExplanationOfBenefitOperationOutcomeBundleResource);

            resp = await request
                .get('/4_0_0/ExplanationOfBenefit')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedExplanationOfBenefitBundleResource);
        });
    });
});
