// test file
const personResources = require('./fixtures/person/person.json');

// expected
const expectedResponse = require('./fixtures/expected/expectedResponse.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Person Validation Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Person Tests', () => {
        test('Person validations', async () => {
            const request = await createTestRequest();

            const resp = await request
                .post('/4_0_0/Person/$merge')
                .send(personResources)
                .set(getHeaders())
                .expect(200);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse);
        });
    });
});
