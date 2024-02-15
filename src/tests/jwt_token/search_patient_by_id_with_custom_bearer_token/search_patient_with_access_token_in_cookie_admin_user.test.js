// provider file
const patient1Resource = require('./fixtures/patient/patient1.json');
const person1Resource = require('./fixtures/person/person1.json');

// expected
const expectedSinglePatientResource = require('./fixtures/expected/expected_single_patient.json');

const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getUnAuthenticatedHeaders,
    getTokenWithCustomPayload, setupMockOpenIdServer, getHeaders
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('PatientReturnIdWithCustomBearerTokenTests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Patient Search By Id Tests With access Bearer Token only in cookie as admin user', () => {
        test('search by single id works', async () => {
            const request = await createTestRequest();
            const payload = {
                'sub': 'f559569d-a6c8-4f70-8447-489b42f48b07',
                'groups': [
                    'admin/*.*',
                    'user/*.*',
                    'access/*.*'
                ],
                'token_use': 'access',
                'scope': 'phone openid profile email',
                'username': 'bwell-demo-provider'
            };
            const token = getTokenWithCustomPayload(payload);
            const patientId = '00100000000';
            const personId = '10';
            setupMockOpenIdServer({ token, patientId, personId });
            let resp = await request
                .get('/4_0_0/Patient')
                .set(getUnAuthenticatedHeaders())
                .set('Cookie', [`jwt=${token}`]);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Patient/00100000000/$merge?validate=true')
                .send(patient1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Person/10/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Patient')
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(1);

            setupMockOpenIdServer({ token, patientId, personId });
            resp = await request
                .get('/4_0_0/Patient')
                .set(getUnAuthenticatedHeaders())
                .set('Cookie', [`jwt=${token}`]);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(1);

            setupMockOpenIdServer({ token, patientId, personId });
            resp = await request
                .get('/4_0_0/Patient/00100000000')
                .set(getUnAuthenticatedHeaders())
                .set('Cookie', [`jwt=${token}`]);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedSinglePatientResource);
        });
    });
});
