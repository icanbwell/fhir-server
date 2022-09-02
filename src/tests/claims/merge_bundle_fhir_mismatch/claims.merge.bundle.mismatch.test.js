const explanationOfBenefitBundleResource1 = require('./fixtures/explanation_of_benefits1.json');
const explanationOfBenefitBundleResource2 = require('./fixtures/explanation_of_benefits2.json');
const explanationOfBenefitBundleResource3 = require('./fixtures/explanation_of_benefits3.json');
const expectedExplanationOfBenefitBundleResource = require('./fixtures/expected_explanation_of_benefits.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const {describe, beforeEach, afterEach} = require('@jest/globals');

describe('Claim Merge Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Claim Merge with overlapping items', () => {
        test('Claims with same claim number in different bundles and similar items merge properly', async () => {
            const request = await createTestRequest();
            let resp = await request.get('/4_0_0/ExplanationOfBenefit').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/ExplanationOfBenefit/1/$merge')
                .send(explanationOfBenefitBundleResource1)
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/ExplanationOfBenefit/1/$merge')
                .send(explanationOfBenefitBundleResource2)
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/ExplanationOfBenefit/1/$merge')
                .send(explanationOfBenefitBundleResource3)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request.get('/4_0_0/ExplanationOfBenefit?_bundle=1').set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedExplanationOfBenefitBundleResource);
        });
    });
});
