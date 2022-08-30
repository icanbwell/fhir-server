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
const { describe, beforeEach, afterEach, expect } = require('@jest/globals');
const {
    assertStatusCode,
    assertMergeIsSuccessful,
    assertCompareBundles,
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
                .set(getHeaders())
                .expect(assertStatusCode(200));

            expect(resp.body.length).toBe(0);

            resp = await request
                .post('/4_0_0/Patient/1679033641/$merge?validate=true')
                .send(patient1Resource)
                .set(getHeaders())
                .expect(assertStatusCode(200));

            assertMergeIsSuccessful(resp.body, true);

            resp = await request.get('/4_0_0/Patient').set(getHeaders()).expect(200);

            expect(resp.body.length).toBe(1);

            await postRequestProcessor.waitTillDoneAsync();
            resp = await request
                .get('/4_0_0/Patient/00100000000/_history')
                .set(getHeaders())
                .expect(200);

            assertCompareBundles({
                body: resp.body,
                expected: expectedHistorySinglePatient,
            });

            // now merge the same patient.  There should be no additional history record created
            resp = await request
                .post('/4_0_0/Patient/1679033641/$merge?validate=true')
                .send(patient1Resource)
                .set(getHeaders())
                .expect(assertStatusCode(200));

            // assertMergeIsSuccessful(resp.body, false);

            await postRequestProcessor.waitTillDoneAsync();
            resp = await request
                .get('/4_0_0/Patient/00100000000/_history')
                .set(getHeaders())
                .expect(200);

            assertCompareBundles({
                body: resp.body,
                expected: expectedHistorySinglePatient,
            });

            // now merge the modified patient.  There should be an additional history record created
            patient1Resource.birthDate = '2015-01-01';
            resp = await request
                .post('/4_0_0/Patient/1679033641/$merge?validate=true')
                .send(patient1Resource)
                .set(getHeaders())
                .expect(assertStatusCode(200));

            assertMergeIsSuccessful(resp.body, false);

            await postRequestProcessor.waitTillDoneAsync();
            resp = await request
                .get('/4_0_0/Patient/00100000000/_history')
                .set(getHeaders())
                .expect(200);

            assertCompareBundles({
                body: resp.body,
                expected: expectedHistorySinglePatientMultipleChanges,
            });
        });
    });
});
