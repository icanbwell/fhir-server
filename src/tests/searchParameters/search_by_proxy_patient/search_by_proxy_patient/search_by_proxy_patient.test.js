// test file
const normalPatient = require('./fixtures/Patient/normalPatient.json');
const observationResource = require('./fixtures/Observation/observation.json');
// const personResource = require('./fixtures/Person/person.json');

// expected
// const expectedPatientResources = require('./fixtures/expected/expected_Patient.json');
const expectedObservationNormal = require('./fixtures/expected/expectedObservationNormal.json');

const {commonBeforeEach, commonAfterEach, getHeaders, createTestRequest} = require('../../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');

describe('Patient Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Patient search_by_proxy_patient Tests', () => {
        test('search by patient for normal patients works', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(normalPatient)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observationResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Patient back
            resp = await request
                .get('/4_0_0/Observation/?_bundle=1&patient=00100000000')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationNormal);
        });
    });
});
