// test file
const patientResources = require('./fixtures/patient/patient.json');

// expected
const expectedResponse = require('./fixtures/expected/oldWrite/expectedResponse.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

process.env.WRITE_PIPELINE_OPERATIONS = '';

describe('Patient Validation Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Patient Tests', () => {
        test('Patient validations', async () => {
            const request = await createTestRequest();

            const resp = await request
                .post('/4_0_0/Patient/$merge')
                .send(patientResources)
                .set(getHeaders())
                .expect(200);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse);
        });
    });
});
