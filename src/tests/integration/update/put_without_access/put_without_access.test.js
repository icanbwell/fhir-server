const patient1Resource = require('./fixtures/patient/patient1.json');
const patient2Resource = require('./fixtures/patient/patient2.json');

const expectedPatient1 = require('./fixtures/expected/expectedPatient1.json');
const expectedPatient2 = require('./fixtures/expected/expectedPatient2.json');

const observation1Resource = require('./fixtures/Observation/observation1.json');
const observation2Resource = require('./fixtures/Observation/observation2.json');

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

    describe('update Tests', () => {
        test('update(create) with scopes matching owner and access tags', async () => {
            const request = await createTestRequest();

            const resp = await request
                .put('/4_0_0/Patient/1')
                .send(patient1Resource)
                .set(getHeaders('access/owner.* access/access.* user/*.*'))
                .expect(201);

            expect(resp).toHaveResponse(expectedPatient1);
        });

        test('update(create) with scopes matching owner tags but not access tags', async () => {
            const request = await createTestRequest();

            const resp = await request
                .put('/4_0_0/Patient/1')
                .send(patient1Resource)
                .set(getHeaders('access/owner.* user/*.*'))
                .expect(403);

            expect(resp).toHaveResponse({
                issue: [
                    {
                        code: 'forbidden',
                        details: {
                            text: 'user imran with scopes [access/owner.* user/*.*] has no write access to resource Patient with id 1'
                        },
                        diagnostics:
                            'user imran with scopes [access/owner.* user/*.*] has no write access to resource Patient with id 1',
                        severity: 'error'
                    }
                ],
                resourceType: 'OperationOutcome'
            });
        });

        test('update(create) with scopes matching access tags but not owner tags', async () => {
            const request = await createTestRequest();

            const resp = await request
                .put('/4_0_0/Patient/1')
                .send(patient1Resource)
                .set(getHeaders('access/access.* user/*.*'))
                .expect(403);

            expect(resp).toHaveResponse({
                issue: [
                    {
                        code: 'forbidden',
                        details: {
                            text: 'user imran with scopes [access/access.* user/*.*] has no write access to resource Patient with id 1'
                        },
                        diagnostics:
                            'user imran with scopes [access/access.* user/*.*] has no write access to resource Patient with id 1',
                        severity: 'error'
                    }
                ],
                resourceType: 'OperationOutcome'
            });
        });

        test('update(update) with scopes matching owner and access tags', async () => {
            const request = await createTestRequest();

            let resp = await request
                .post('/4_0_0/patient/$merge')
                .send(patient1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .put('/4_0_0/patient/1')
                .send(patient2Resource)
                .set(getHeaders('access/owner.* access/access.* user/*.*'))
                .expect(200);

            expect(resp).toHaveResponse(expectedPatient2);
        });

        test('update(update) with scopes matching owner tags but not access tags', async () => {
            const request = await createTestRequest();

            let resp = await request
                .post('/4_0_0/patient/$merge')
                .send(patient1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .put('/4_0_0/patient/1')
                .send(patient2Resource)
                .set(getHeaders('access/owner.* user/*.*'))
                .expect(403);

            expect(resp).toHaveResponse({
                issue: [
                    {
                        code: 'forbidden',
                        details: {
                            text: 'user imran with scopes [access/owner.* user/*.*] has no write access to resource Patient with id 1'
                        },
                        diagnostics:
                            'user imran with scopes [access/owner.* user/*.*] has no write access to resource Patient with id 1',
                        severity: 'error'
                    }
                ],
                resourceType: 'OperationOutcome'
            });
        });

        test('update(update) with scopes matching access tags but not owner tags', async () => {
            const request = await createTestRequest();

            let resp = await request
                .post('/4_0_0/patient/$merge')
                .send(patient1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .put('/4_0_0/patient/1')
                .send(patient2Resource)
                .set(getHeaders('access/access.* user/*.*'))
                .expect(403);

            expect(resp).toHaveResponse({
                issue: [
                    {
                        code: 'forbidden',
                        details: {
                            text: 'user imran with scopes [access/access.* user/*.*] has no write access to resource Patient with id 1'
                        },
                        diagnostics:
                            'user imran with scopes [access/access.* user/*.*] has no write access to resource Patient with id 1',
                        severity: 'error'
                    }
                ],
                resourceType: 'OperationOutcome'
            });
        });

        test('Resource access tag is not updated if no acccess to resource', async () => {
            const request = await createTestRequest();
            // Create api hit with valid resource

            let createResp = await request
                .post('/4_0_0/Observation/$merge')
                .send(observation1Resource)
                .set(getHeaders())
                .expect(200);

            let resp = await request
                .put('/4_0_0/Observation/' + createResp._body.uuid)
                .send(observation2Resource)
                .set(getHeaders('access/access.* user/*.*'))

            expect(resp).toHaveResponse({
                issue: [
                    {
                        code: 'forbidden',
                        details: {
                            text: 'user imran with scopes [access/access.* user/*.*] has no write access to resource Observation with id 1'
                        },
                        diagnostics:
                            'user imran with scopes [access/access.* user/*.*] has no write access to resource Observation with id 1',
                        severity: 'error'
                    }
                ],
                resourceType: 'OperationOutcome'
            });
        });
    });
});
