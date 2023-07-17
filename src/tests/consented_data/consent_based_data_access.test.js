// test file
const masterPersonResource = require('./fixtures/person/master_person.json');
const clientPersonResource = require('./fixtures/person/client_person.json');
const proaPersonResource = require('./fixtures/person/proa_person.json');
const masterPatientResource = require('./fixtures/patient/master_patient.json');
const clientPatientResource = require('./fixtures/patient/client_patient.json');
const proaPatientResource = require('./fixtures/patient/proa_patient.json');
const clientObservationResource = require('./fixtures/observation/client_observation.json');
const proaObservationResource = require('./fixtures/observation/proa_observation.json');
const consentGivenResource = require('./fixtures/consent/consent_given.json');
const consentDeniedResource = require('./fixtures/consent/consent_denied.json');

// expected
const expectedObservationWhenConsentedResources = require('./fixtures/expected/observation_when_consented.json');
const expectedObservationWhenNotConsentedResources = require('./fixtures/expected/observation_when_not_consented.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');


const headers = getHeaders('user/*.read access/client.*');
describe('Consent Based Data Access Test', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Observation Resource data read by Client Credentails', () => {
        test('consent object not created yet', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, clientPersonResource, proaPersonResource, masterPatientResource,
                    clientPatientResource, proaPatientResource, clientObservationResource, proaObservationResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // Get Observation for a specific person
            resp = await request
                .get('/4_0_0/Observation?patient=Patient/person.b12345')
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationWhenNotConsentedResources);
        });
        test('Consent has provided to Client', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, clientPersonResource, proaPersonResource, masterPatientResource,
                    clientPatientResource, proaPatientResource, clientObservationResource, proaObservationResource, consentGivenResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // Get Observation for a specific person
            resp = await request
                .get('/4_0_0/Observation?patient=Patient/person.b12345')
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationWhenConsentedResources);
        });

        test('Consent has created but denied access to Client', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, clientPersonResource, proaPersonResource, masterPatientResource,
                    clientPatientResource, proaPatientResource, clientObservationResource, proaObservationResource, consentDeniedResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // Get Observation for a specific person
            resp = await request
                .get('/4_0_0/Observation?patient=Patient/person.b12345')
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationWhenNotConsentedResources);
        });
    });
});
