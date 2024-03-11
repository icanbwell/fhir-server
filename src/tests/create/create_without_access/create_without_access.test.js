const patient1Resource = require('./fixtures/patient/patient1.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test } = require('@jest/globals');

describe('Patient Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('merge Tests', () => {
        test('merge(create) with scopes matching owner and access tags', async () => {
            const request = await createTestRequest();

            await request
                .post('/4_0_0/Patient/')
                .send(patient1Resource)
                .set(getHeaders('access/owner.* access/access.* user/*.*'))
                .expect(201);
        });

        test('merge(create) with scopes matching owner tags but not access tags', async () => {
            const request = await createTestRequest();

            await request
                .post('/4_0_0/Patient/')
                .send(patient1Resource)
                .set(getHeaders('access/owner.* user/*.*'))
                .expect(403);
        });

        test('merge(create) with scopes matching access tags but not owner tags', async () => {
            const request = await createTestRequest();

            await request
                .post('/4_0_0/Patient/')
                .send(patient1Resource)
                .set(getHeaders('access/access.* user/*.*'))
                .expect(403);
        });
    });
});
