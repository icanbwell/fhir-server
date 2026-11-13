// test file
const medicationStatementResources = require('./fixtures/medicationStatement/medicationStatement.json');

// expected
const expectedResponse = require('./fixtures/expected/oldWrite/expectedResponse.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

process.env.WRITE_PIPELINE_OPERATIONS = '';

describe('MedicationStatement Validation Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('MedicationStatement Tests', () => {
        test('MedicationStatement validations', async () => {
            const request = await createTestRequest();

            const resp = await request
                .post('/4_0_0/MedicationStatement/$merge')
                .send(medicationStatementResources)
                .set(getHeaders())
                .expect(200);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse);
        });
    });
});
