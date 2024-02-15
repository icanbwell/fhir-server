const explanationOfBenefitBundleResource = require('./fixtures/explanation_of_benefits/explanation_of_benefits.json');
const expectedExplanationOfBenefitBundleResource = require('./fixtures/expected/expected_explanation_of_benefits.json');
const expectedMergeResponse = require('./fixtures/expected/expected_merge_response.json');
const expectedPatientBundleResource = require('./fixtures/expected/expected_patients.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Claim Merge Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Claim Merge Bundles', () => {
        test('Claims with heterogeneous resources merge properly', async () => {
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
            expect(resp).toHaveMergeResponse(expectedMergeResponse);

            resp = await request
                .get('/4_0_0/ExplanationOfBenefit?_bundle=1')
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedExplanationOfBenefitBundleResource);

            resp = await request.get('/4_0_0/Patient?_bundle=1').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPatientBundleResource);
        });
    });
});
