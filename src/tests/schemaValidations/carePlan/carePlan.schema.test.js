// test file
const carePlanResources = require('./fixtures/carePlan/carePlan.json');

// expected
const expectedResponse = require('./fixtures/expected/expectedResponse.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('CarePlan Validation Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('CarePlan Tests', () => {
        test('CarePlan validations', async () => {
            const request = await createTestRequest();

            const resp = await request
                .post('/4_0_0/CarePlan/$merge')
                .send(carePlanResources)
                .set(getHeaders())
                .expect(200);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse);
        });
    });
});
