const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');

const {describe, beforeEach, afterEach, test, expect} = require('@jest/globals');

describe('Person Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('merge Tests', () => {
        test('merge without data', async () => {
            const request = await createTestRequest();

            await request
                .post('/4_0_0/Person/$merge')
                .send({})
                .set(getHeaders())
                .expect(400);
        });

        test('should return empty array when bundle entry is empty array', async () => {
            const request = await createTestRequest();
            const resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send({
                    resourceType: 'Bundle',
                    entry: []
                })
                .set(getHeaders());

            expect(resp).toHaveMergeResponse([]);
        });

        test('should return empty array when body is an empty array', async () => {
            const request = await createTestRequest();
            const resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([])
                .set(getHeaders());

            expect(resp).toHaveMergeResponse([]);
        });
    });
});
