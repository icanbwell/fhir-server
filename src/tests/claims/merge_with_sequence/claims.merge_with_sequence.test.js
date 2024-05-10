const explanationOfBenefit1 = require('./fixtures/explanation_of_benefits1.json');
const explanationOfBenefit2 = require('./fixtures/explanation_of_benefits2.json');
const expectedExplanationOfBenefit1 = require('./fixtures/expected_explanation_of_benefits1.json');
const expectedExplanationOfBenefit2 = require('./fixtures/expected_explanation_of_benefits2.json');

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

    describe('Claim Sequence Merge', () => {
        test('Update with sequence and id should work', async () => {
            const request = await createTestRequest();
            let resp = await request
                .get('/4_0_0/ExplanationOfBenefit')
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/ExplanationOfBenefit/$merge')
                .send(explanationOfBenefit1)
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/ExplanationOfBenefit/1')
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedExplanationOfBenefit1);

            resp = await request
                .post('/4_0_0/ExplanationOfBenefit/$merge')
                .send(explanationOfBenefit2)
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ updated: true });

            resp = await request
                .get('/4_0_0/ExplanationOfBenefit/1')
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedExplanationOfBenefit2);
        });
    });
});
