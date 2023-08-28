const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');

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
    });
});
