// test file
const coverageResources = require('./fixtures/coverage/coverage.json');

// expected
const expectedResponse = require('./fixtures/expected/oldWrite/expectedResponse.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

process.env.WRITE_PIPELINE_OPERATIONS = '';

describe('Coverage Validation Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Coverage Tests', () => {
        test('Coverage validations', async () => {
            const request = await createTestRequest();

            const resp = await request
                .post('/4_0_0/Coverage/$merge')
                .send(coverageResources)
                .set(getHeaders())
                .expect(200);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse);
        });
    });
});
