// provider file
const patient1Resource = require('./fixtures/patient/patient1.json');

// expected
const expectedSinglePatientResource = require('./fixtures/expected/expected_single_patient.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');

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


            resp = await request
                .post('/4_0_0/Patient/1679033641/$merge?validate=true')
                .send(patient1Resource)
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});


            resp = await request.get('/4_0_0/Patient').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(1);


            resp = await request.get('/4_0_0/Patient/00100000000').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedSinglePatientResource[0]);

            resp = await request.post('/4_0_0/Patient/_search?id=00100000000').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedSinglePatientResource[0]);

            resp = await request.get('/4_0_0/Patient/_search').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(404);
        });
    });
});
