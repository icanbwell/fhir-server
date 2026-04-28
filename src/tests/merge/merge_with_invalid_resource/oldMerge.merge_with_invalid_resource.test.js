// test file
const invalidResource = require('./fixtures/Invalid_Resource.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');

const { describe, beforeEach, afterEach, test, expect, beforeAll, afterAll } = require('@jest/globals');

describe('Invalid Resource Tests', () => {
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

    describe('Invalid Resource Merge Tests', () => {
        test('Merge throws 400 status code', async () => {
            const request = await createTestRequest();
            // Case when meta.source doesn't exist
            const resp = await request
                .post('/4_0_0/Person/$merge')
                .send(invalidResource)
                .set(getHeaders())
                .expect(200);
            expect(
                resp.body.operationOutcome.issue[0].details.text
            ).toStrictEqual(
                'Unable to create/update resource. Missing either metadata or metadata source.'
            );
        });
    });
});
