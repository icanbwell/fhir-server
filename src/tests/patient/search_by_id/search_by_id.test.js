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
const {describe, beforeEach, afterEach} = require('@jest/globals');
const {expectResourceCount, expectMergeResponse, expectResponse} = require('../../fhirAsserts');

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
            expectResourceCount(resp, 0);


            resp = await request
                .post('/4_0_0/Patient/1679033641/$merge?validate=true')
                .send(patient1Resource)
                .set(getHeaders());

            expectMergeResponse(resp, {created: true});


            resp = await request.get('/4_0_0/Patient').set(getHeaders());
            expectResourceCount(resp, 1);


            resp = await request.get('/4_0_0/Patient/00100000000').set(getHeaders());
            expectResponse(resp, expectedSinglePatientResource[0]);
        });
    });
});
