// test file
const explanationOfBenefitResources = require('./fixtures/explanationOfBenefit/explanationOfBenefit.json');

// expected
const expectedResponse = require('./fixtures/expected/oldWrite/expectedResponse.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

process.env.WRITE_PIPELINE_OPERATIONS = '';

describe('ExplanationOfBenefit Validation Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('ExplanationOfBenefit Tests', () => {
        test('ExplanationOfBenefit validations', async () => {
            const request = await createTestRequest();

            const resp = await request
                .post('/4_0_0/ExplanationOfBenefit/$merge')
                .send(explanationOfBenefitResources)
                .set(getHeaders())
                .expect(200);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse);
        });
    });
});
