const patient1Resource = require('./fixtures/patient/patient1.json');
const patient2Resource = require('./fixtures/patient/patient2.json');

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

    describe('merge Tests', () => {
        test('merge(create) with scopes matching owner tags but not access tags', async () => {
            const request = await createTestRequest();

            const resp = await request
                .post('/4_0_0/Person/$merge')
                .send(patient1Resource)
                .set(getHeaders('access/owner.* user/*.*'))
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });
        });

        test('merge(create) with scopes matching access tags but not owner tags', async () => {
            const request = await createTestRequest();

            const resp = await request
                .post('/4_0_0/Person/$merge')
                .send(patient1Resource)
                .set(getHeaders('access/access.* user/*.*'))
                .expect(200);

            expect(resp).toHaveMergeResponse({
                issue: {
                    code: 'forbidden',
                    details: {
                        text: 'user imran with scopes [access/access.* user/*.*] has no write access to resource Patient with id 1'
                    },
                    diagnostics:
                        'user imran with scopes [access/access.* user/*.*] has no write access to resource Patient with id 1',
                    severity: 'error'
                }
            });
        });

        test('merge(update) with scopes matching owner tags but not access tags', async () => {
            const request = await createTestRequest();

            let resp = await request
                .post('/4_0_0/Person/$merge')
                .send(patient1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Person/$merge')
                .send(patient2Resource)
                .set(getHeaders('access/owner.* user/*.*'))
                .expect(200);

            expect(resp).toHaveMergeResponse({ updated: true });
        });

        test('merge(update) with scopes matching access tags but not owner tags', async () => {
            const request = await createTestRequest();

            let resp = await request
                .post('/4_0_0/Person/$merge')
                .send(patient1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Person/$merge')
                .send(patient2Resource)
                .set(getHeaders('access/access.* user/*.*'))
                .expect(200);

            expect(resp).toHaveMergeResponse({
                issue: {
                    code: 'forbidden',
                    details: {
                        text: 'user imran with scopes [access/access.* user/*.*] has no write access to resource Patient with id 1'
                    },
                    diagnostics:
                        'user imran with scopes [access/access.* user/*.*] has no write access to resource Patient with id 1',
                    severity: 'error'
                }
            });
        });
    });
});
