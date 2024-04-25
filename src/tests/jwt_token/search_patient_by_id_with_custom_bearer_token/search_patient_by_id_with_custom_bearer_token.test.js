// provider file
const patient1Resource = require('./fixtures/patient/patient1.json');

// expected
const expectedSinglePatientResource = require('./fixtures/expected/expected_single_patient.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeadersWithCustomToken,
    createTestRequest,
    getUnAuthenticatedHeaders,
    getFullAccessToken,
    getHeadersWithCustomPayload
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { logInfo } = require('../../../operations/common/logging');

describe('PatientReturnIdWithCustomBearerTokenTests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Patient Search By Id Tests With Custom Bearer Token', () => {
        test('search by single id works', async () => {
            const request = await createTestRequest();
            let resp = await request
                .get('/4_0_0/Patient')
                .set(getHeadersWithCustomToken())
                .expect(200);
            expect(resp.body.length).toBe(0);
            logInfo('------- response 1 ------------');
            logInfo('', { resp: resp.body });
            logInfo('------- end response 1 ------------');
            resp = await request
                .post('/4_0_0/Patient/1679033641/$merge?validate=true')
                .send(patient1Resource)
                .set(getHeadersWithCustomToken())
                .expect(200);
            logInfo('------- response patient1Resource ------------');
            logInfo('', { resp: resp.body });
            logInfo('------- end response  ------------');
            expect(resp.body.created).toBe(true);
            resp = await request.get('/4_0_0/Patient').set(getHeadersWithCustomToken()).expect(200);
            logInfo('------- response 3 ------------');
            logInfo('', { resp: resp.body });
            logInfo('------- end response 3 ------------');
            resp = await request
                .get('/4_0_0/Patient/00100000000')
                .set(getHeadersWithCustomToken())
                .expect(200);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedSinglePatientResource);
        });

        test('search without client id doesn\'t works', async () => {
            const request = await createTestRequest();
            const headers = getHeadersWithCustomPayload({
                custom_client_id: undefined,
                customscope: 'access/*.* patient/*.* openid/*.*',
                groups: ['access/*.*'],
                token_use: 'access'
            });

            // search without client id throws 401 error and doesn't hang
            await request
                .get('/4_0_0/Patient')
                .set(headers)
                .expect(401);
        });
    });

    describe('Patient Search By Id Tests With x-well-identity Bearer Token should fail', () => {
        test('search by id do not work', async () => {
            const request = await createTestRequest();
            const headers = { ...getUnAuthenticatedHeaders(), 'x-bwell-identity': getFullAccessToken() };
            await request
                .get('/4_0_0/Patient')
                .set(headers)
                .expect(401);
        });
    });

    describe('Patient Search By Id Tests Without required jwt fields should fail', () => {
        test('search by id do not work as person & patient ids are not provided in access token', async () => {
            const request = await createTestRequest();
            const payload = {
                'cognito:username': 'patient-123@example.com',
                scope: 'patient/Observation.*',
                username: 'patient-123@example.com',
                token_use: 'access'
            };
            const headers = getHeadersWithCustomPayload(payload);
            await request
                .get('/4_0_0/Patient')
                .set(headers)
                .expect(401);
        });
    });

    describe('Patient Search By Id Tests with id token should fail', () => {
        test('search by id do not work as id token provided', async () => {
            const request = await createTestRequest();
            const payload = {
                'cognito:username': 'patient-123@example.com',
                scope: 'patient/Observation.*',
                username: 'patient-123@example.com',
                clientFhirPersonId: 'clientFhirPerson',
                clientFhirPatientId: 'clientFhirPatient',
                bwellFhirPersonId: 'person1',
                bwellFhirPatientId: 'bwellFhirPatient'
            };
            const headers = getHeadersWithCustomPayload(payload);
            await request
                .get('/4_0_0/Patient')
                .set(headers)
                .expect(401);
        });
    });
});
