// test file
const medicationRequestResources = require('./fixtures/medicationRequest/medicationRequest.json');

// expected
const expectedResponse = require('./fixtures/expected/expectedResponse.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('MedicationRequest Validation Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('MedicationRequest Tests', () => {
        test('MedicationRequest validations', async () => {
            const request = await createTestRequest();

            const resp = await request
                .post('/4_0_0/MedicationRequest/$merge')
                .send(medicationRequestResources)
                .set(getHeaders())
                .expect(200);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse);
        });
    });
});
