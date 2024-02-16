// test file
const invalidResource = require('./fixtures/Invalid_Resource.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');

const { describe, beforeEach, afterEach, test } = require('@jest/globals');

describe('Invalid Resource Tests', () => {
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
            await request
                .post('/4_0_0/Person/$merge')
                .send(invalidResource)
                .set(getHeaders())
                .expect(400);
        });
    });
});
