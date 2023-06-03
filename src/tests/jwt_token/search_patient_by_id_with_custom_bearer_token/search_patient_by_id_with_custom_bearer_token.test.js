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
    getFullAccessToken, getHeadersWithCustomPayload, setMockOpenId,
} = require('../../common');
const {describe, beforeEach, afterEach, expect, test} = require('@jest/globals');
const {logInfo} = require('../../../operations/common/logging');

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
            logInfo('', {'resp': resp.body});
            logInfo('------- end response 1 ------------');
            resp = await request
                .post('/4_0_0/Patient/1679033641/$merge?validate=true')
                .send(patient1Resource)
                .set(getHeadersWithCustomToken())
                .expect(200);
            logInfo('------- response patient1Resource ------------');
            logInfo('', {'resp': resp.body});
            logInfo('------- end response  ------------');
            expect(resp.body['created']).toBe(true);
            resp = await request.get('/4_0_0/Patient').set(getHeadersWithCustomToken()).expect(200);
            logInfo('------- response 3 ------------');
            logInfo('', {'resp': resp.body});
            logInfo('------- end response 3 ------------');
            resp = await request
                .get('/4_0_0/Patient/00100000000')
                .set(getHeadersWithCustomToken())
                .expect(200);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedSinglePatientResource);
        });
    });

    describe('Patient Search By Id Tests With x-well-identity Bearer Token', () => {
        test('search by single id works', async () => {
            const request = await createTestRequest();
            const headers = {...getUnAuthenticatedHeaders(), 'x-bwell-identity': getFullAccessToken()};
            let resp = await request
                .get('/4_0_0/Patient')
                .set(headers)
                .expect(200);
            expect(resp.body.length).toBe(0);
            logInfo('------- response 1 ------------');
            logInfo('', {'resp': resp.body});
            logInfo('------- end response 1 ------------');
            resp = await request
                .post('/4_0_0/Patient/1679033641/$merge?validate=true')
                .send(patient1Resource)
                .set(headers)
                .expect(200);
            logInfo('------- response patient1Resource ------------');
            logInfo('', {'resp': resp.body});
            logInfo('------- end response  ------------');
            expect(resp.body['created']).toBe(true);
            resp = await request.get('/4_0_0/Patient').set(getHeadersWithCustomToken()).expect(200);
            logInfo('------- response 3 ------------');
            logInfo('', {'resp': resp.body});
            logInfo('------- end response 3 ------------');
            resp = await request
                .get('/4_0_0/Patient/00100000000')
                .set(headers)
                .expect(200);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedSinglePatientResource);
        });
    });

    describe('Patient Search By Id Tests With access Bearer Token only', () => {
        test('search by single id works', async () => {
            const request = await createTestRequest();
            const headers = getHeadersWithCustomPayload({
                'sub': 'f559569d-a6c8-4f70-8447-489b42f48b07',
                'token_use': 'access',
                'scope': 'launch/patient patient/Patient.read patient/*.read phone openid profile email',
                'username': 'bwell-demo-provider'
            });
            setMockOpenId();
            let resp = await request
                .get('/4_0_0/Patient')
                .set(headers)
                .expect(200);
            expect(resp.body.length).toBe(0);
            resp = await request
                .post('/4_0_0/Patient/1679033641/$merge?validate=true')
                .send(patient1Resource)
                .set(headers)
                .expect(200);
            logInfo('------- response patient1Resource ------------');
            logInfo('', {'resp': resp.body});
            logInfo('------- end response  ------------');
            expect(resp.body['created']).toBe(true);
            resp = await request.get('/4_0_0/Patient').set(getHeadersWithCustomToken()).expect(200);
            logInfo('------- response 3 ------------');
            logInfo('', {'resp': resp.body});
            logInfo('------- end response 3 ------------');
            resp = await request
                .get('/4_0_0/Patient/00100000000')
                .set(headers)
                .expect(200);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedSinglePatientResource);
        });
    });
});
