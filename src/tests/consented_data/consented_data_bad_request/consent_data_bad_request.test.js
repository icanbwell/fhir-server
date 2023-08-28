// test file
const masterPersonResource = require('./fixtures/person/master_person.json');
const clientPersonResource = require('./fixtures/person/client_person.json');
const proaPersonResource = require('./fixtures/person/proa_person.json');
const masterPatientResource = require('./fixtures/patient/master_patient.json');
const clientPatientResource = require('./fixtures/patient/client_patient.json');
const proaPatientResource = require('./fixtures/patient/proa_patient.json');
const clientObservationResource = require('./fixtures/observation/client_observation.json');
const proaObservationResource = require('./fixtures/observation/proa_observation.json');
const masterPersonResource2 = require('./fixtures/person/master_person2.json');
const clientPersonResource2 = require('./fixtures/person/client_person2.json');
const proaPersonResource2 = require('./fixtures/person/proa_person2.json');
const masterPatientResource2 = require('./fixtures/patient/master_patient2.json');
const clientPatientResource2 = require('./fixtures/patient/client_patient2.json');
const proaPatientResource2 = require('./fixtures/patient/proa_patient2.json');
const proaObservationResource2 = require('./fixtures/observation/proa_observation2.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');


const headers = getHeaders('user/*.read access/client.*');

describe('Consent Based Data Access Test', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Bad Requests', () => {
        test('should throw error when multiple patients are present for a given patient ids', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, clientPersonResource, proaPersonResource, masterPatientResource,
                    clientPatientResource, proaPatientResource, clientObservationResource, proaObservationResource,
                    masterPersonResource2, clientPersonResource2, proaPersonResource2, masterPatientResource2,
                    clientPatientResource2, proaPatientResource, proaPatientResource2, proaObservationResource2
                ])
                .set(getHeaders());
            // Get Observation for a specific person
            resp = await request
                .get('/4_0_0/Observation?patient=Patient/test-patient')
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(400);
        });
    });
});
