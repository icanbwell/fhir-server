// provider file
const patient1Resource = require('./fixtures/patient/patient1.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('PatientReturnIdTests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Patient Search By Id Tests', () => {
        test('search by single id works', async () => {
            const request = await createTestRequest();
            let resp = await request
                .get('/4_0_0/Patient')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            const headers = getHeaders();
            headers['Content-Type'] = 'application/json';
            resp = await request
                .post('/4_0_0/Patient/1679033641/$merge?validate=true')
                .send(patient1Resource)
                .set(headers);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(400);
            expect(resp.body).toStrictEqual(
                {
                    message: 'Content Type application/json is not supported. Please use one of: application/fhir+json,application/json+fhir,application/json-patch+json,application/fhir+ndjson'
                }
            );

            resp = await request
                .get('/4_0_0/Patient')
                .set(headers);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(200);

            resp = await request
                .get('/4_0_0/Patient/_search')
                .set(headers);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(404);
        });
    });
});
