// test file
const encounterResources = require('./fixtures/encounter/encounter.json');

// expected
const expectedResponse = require('./fixtures/expected/expectedResponse.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Encounter Validation Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Encounter Tests', () => {
        test('Encounter validations', async () => {
            const request = await createTestRequest();

            const resp = await request
                .post('/4_0_0/Encounter/$merge')
                .send(encounterResources)
                .set(getHeaders())
                .expect(200);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse);
        });
    });
});
