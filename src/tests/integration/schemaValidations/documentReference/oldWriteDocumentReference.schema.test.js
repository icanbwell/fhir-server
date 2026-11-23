// test file
const documentReferenceResources = require('./fixtures/documentReference/documentReference.json');

// expected
const expectedResponse = require('./fixtures/expected/oldWrite/expectedResponse.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

process.env.WRITE_PIPELINE_OPERATIONS = '';

describe('DocumentReference Validation Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('DocumentReference Tests', () => {
        test('DocumentReference validations', async () => {
            const request = await createTestRequest();

            const resp = await request
                .post('/4_0_0/DocumentReference/$merge')
                .send(documentReferenceResources)
                .set(getHeaders())
                .expect(200);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse);
        });
    });
});
