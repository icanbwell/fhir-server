const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');

const { describe, beforeEach, afterEach, test, expect, beforeAll, afterAll } = require('@jest/globals');

describe('Person Tests', () => {
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
