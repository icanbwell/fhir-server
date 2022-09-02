// provider file
const patient1Resource = require('./fixtures/patient/patient1.json');

// expected
const expectedHistorySinglePatient = require('./fixtures/expected/expected_history_single_patient.json');
const expectedHistorySinglePatientMultipleChanges = require('./fixtures/expected/expected_history_single_patient_multiple_changes.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer,
} = require('../../common');
const {describe, beforeEach, afterEach} = require('@jest/globals');
const {
    expectResourceCount, expectMergeResponse, expectResponse
} = require('../../fhirAsserts');

describe('PractitionerReturnIdTests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Patient Search By Id Tests', () => {
        test('history by single id works', async () => {
            const request = await createTestRequest();
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = getTestContainer().postRequestProcessor;
            let resp = await request
                .get('/4_0_0/Patient')
                .set(getHeaders());
            expectResourceCount(resp, 0);

            resp = await request
                .post('/4_0_0/Patient/1679033641/$merge?validate=true')
                .send(patient1Resource)
                .set(getHeaders());
            expectMergeResponse(resp, {created: true});

            resp = await request.get('/4_0_0/Patient').set(getHeaders()).expect(200);
            expectResourceCount(resp, 1);

            await postRequestProcessor.waitTillDoneAsync();
            resp = await request
                .get('/4_0_0/Patient/00100000000/_history')
                .set(getHeaders())
                .expect(200);

            expectResponse(resp, expectedHistorySinglePatient);

            // now merge the same patient.  There should be no additional history record created
            resp = await request
                .post('/4_0_0/Patient/1679033641/$merge?validate=true')
                .send(patient1Resource)
                .set(getHeaders());
            expectMergeResponse(resp, {created: true});

            // assertMergeIsSuccessful(resp.body, false);

            await postRequestProcessor.waitTillDoneAsync();
            resp = await request
                .get('/4_0_0/Patient/00100000000/_history')
                .set(getHeaders())
                .expect(200);

            expectResponse(resp, expectedHistorySinglePatient);

            // now merge the modified patient.  There should be an additional history record created
            patient1Resource.birthDate = '2015-01-01';
            resp = await request
                .post('/4_0_0/Patient/1679033641/$merge?validate=true')
                .send(patient1Resource)
                .set(getHeaders());
            expectMergeResponse(resp, {updated: true});

            await postRequestProcessor.waitTillDoneAsync();
            resp = await request
                .get('/4_0_0/Patient/00100000000/_history')
                .set(getHeaders())
                .expect(200);

            expectResponse(resp, expectedHistorySinglePatientMultipleChanges);
        });
    });
});
