// test file
const coverageResources = require('./fixtures/coverage/coverage.json');

// expected
const expectedResponse = require('./fixtures/expected/expectedResponse.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect, beforeAll, afterAll } = require('@jest/globals');

describe('Coverage Validation Tests', () => {
    let originalMergeFastSerializerValue;

    beforeAll(() => {
        originalMergeFastSerializerValue = process.env.ENABLE_MERGE_FAST_SERIALIZER;
        process.env.ENABLE_MERGE_FAST_SERIALIZER = '0';
    });

    afterAll(() => {
        process.env.ENABLE_MERGE_FAST_SERIALIZER = originalMergeFastSerializerValue;
    });

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
