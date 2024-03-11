const patient1Resource = require('./fixtures/patient/patient1.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Patient Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('remove Tests', () => {
        test('remove with scopes matching owner tags but not access tags', async () => {
            const request = await createTestRequest();

            const resp = await request
                .post('/4_0_0/Patient/$merge')
                .send(patient1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            await request
                .delete('/4_0_0/Patient/1')
                .set(getHeaders('access/owner.* user/*.*'))
                .expect(204);

            await request
                .get('/4_0_0/Patient/1')
                .set(getHeaders())
                .expect(404);
        });

        test('remove with scopes matching access tags but not owner tags', async () => {
            const request = await createTestRequest();

            const resp = await request
                .post('/4_0_0/Patient/$merge')
                .send(patient1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            await request
                .delete('/4_0_0/Patient/1')
                .set(getHeaders('access/access.* user/*.*'))
                .expect(204);

            await request
                .get('/4_0_0/Patient/1')
                .set(getHeaders())
                .expect(200);
        });
    });
});
