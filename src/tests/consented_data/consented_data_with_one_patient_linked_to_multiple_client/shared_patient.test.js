// test file
const masterPersonResource = require('./fixtures/person/master_person.json');
const client1personResource = require('./fixtures/person/client_1_person.json');
const client2PersonResource = require('./fixtures/person/client_2_person.json');

// patient
const masterPatientResource = require('./fixtures/patient/master_patient.json');
const client1PatientResource = require('./fixtures/patient/client_1_patient.json');
const client2PatientResource = require('./fixtures/patient/client_2_patient.json');
const sharedHighmarkPatientResource = require('./fixtures/patient/common_patient_high_mark.json');
const xyz_client_1PatientResource = require('./fixtures/patient/xyz_patient_1.json');
const xyz_client_2PatientResource = require('./fixtures/patient/xyz_patient_2.json');

// observations
const client1ObservationResource = require('./fixtures/observation/observation_client_1_patient.json');
const client2ObservationResource = require('./fixtures/observation/observation_client_2_patient.json');
const commonHighmarkObservationResource = require('./fixtures/observation/observation_highmark_patient.json');
const xyzClient1ObservationResource = require('./fixtures/observation/observation_xyz_patient_1.json');
const xyzClient2ObservationResource = require('./fixtures/observation/observation_xyz_patient_2.json');

// consent
const consentGivenClient1 = require('./fixtures/consent/client_1_consent_given.json');
const consentGivenClient2 = require('./fixtures/consent/client_2_consent_given.json');

// expected
const expectedClient1PatientResource = require('./fixtures/expected/client_1_patient_without_consent.json');
const expectedClient2PatientResource = require('./fixtures/expected/client_2_patient_without_consent.json');
const expectedClient1ObservationResource = require('./fixtures/expected/client_1_observation_without_consent.json');
const expectedClient2ObservationResource = require('./fixtures/expected/client_2_observation_without_consent.json');

const expectedClient1ConsentedObservationResource = require('./fixtures/expected/client_1_observation_with_consent.json');
const expectedClient2ConsentedObservationResource = require('./fixtures/expected/client_2_observation_with_consent.json');
const expectedClient1ConsentPatientResource = require('./fixtures/expected/client_1_patient_with_consent.json');
const expectedClient2ConsentPatientResource = require('./fixtures/expected/client_2_patient_with_consent.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, jest, expect } = require('@jest/globals');
const { DatabasePartitionedCursor } = require('../../../dataLayer/databasePartitionedCursor');

const headers = getHeaders();
const client1Headers = getHeaders('user/*.read access/client-1.*');
const client2Headers = getHeaders('user/*.read access/client-2.*');

describe('Consent Based Data Access Test With Shared Patient', () => {
    const cursorSpy = jest.spyOn(DatabasePartitionedCursor.prototype, 'hint');

    beforeEach(async () => {
        cursorSpy.mockReturnThis();
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('Consent with shared patient flow', async () => {
        const request = await createTestRequest((c) => {
            return c;
        });

        // Add the resources to FHIR server
        let resp = await request
            .post('/4_0_0/Person/1/$merge')
            .send([
                masterPersonResource,
                client1personResource,
                client2PersonResource,

                // patient
                masterPatientResource,
                client1PatientResource,
                client2PatientResource,
                sharedHighmarkPatientResource,
                xyz_client_1PatientResource,
                xyz_client_2PatientResource,

                // observation
                client1ObservationResource,
                client2ObservationResource,
                commonHighmarkObservationResource,
                xyzClient1ObservationResource,
                xyzClient2ObservationResource
            ])
            .set(headers);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });
        expect(resp).toHaveResourceCount(14);

        resp = await request
            .get(`/4_0_0/Patient/?id=person.${masterPersonResource.id}&_rewritePatientReference=0`)
            .set(client1Headers);
        expect(resp).toHaveResponse(expectedClient1PatientResource);

        resp = await request
            .get(`/4_0_0/Patient/?id=person.${masterPersonResource.id}&_rewritePatientReference=0`)
            .set(client2Headers);
        expect(resp).toHaveResponse(expectedClient2PatientResource);

        resp = await request
            .get(
                `/4_0_0/Observation/?subject=Patient/person.${masterPersonResource.id}&_rewritePatientReference=0`
            )
            .set(client1Headers);
        expect(resp).toHaveResponse(expectedClient1ObservationResource);

        resp = await request
            .get(
                `/4_0_0/Observation/?subject=Patient/person.${masterPersonResource.id}&_rewritePatientReference=0`
            )
            .set(client2Headers);
        expect(resp).toHaveResponse(expectedClient2ObservationResource);

        // now give consent
        resp = await request
            .post('/4_0_0/Consent/$merge')
            .send([consentGivenClient1, consentGivenClient2])
            .set(headers);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });
        expect(resp).toHaveResourceCount(2);

        // now it should return consented resources
        resp = await request
            .get(
                `/4_0_0/Observation/?subject=Patient/person.${masterPersonResource.id}&_rewritePatientReference=0`
            )
            .set(client1Headers);
        expect(resp).toHaveResponse(expectedClient1ConsentedObservationResource);

        // now it should return consented resources
        resp = await request
            .get(
                `/4_0_0/Patient/?id=person.${masterPersonResource.id}&_rewritePatientReference=0&_bundle=1&_debug=1`
            )
            .set(client1Headers);
        expect(resp).toHaveMongoQuery(expectedClient1ConsentPatientResource);
        expect(resp).toHaveResponse(expectedClient1ConsentPatientResource);

        // now it should return consented resources
        resp = await request
            .get(
                `/4_0_0/Observation/?subject=Patient/person.${masterPersonResource.id}&_rewritePatientReference=0`
            )
            .set(client2Headers);
        expect(resp).toHaveResponse(expectedClient2ConsentedObservationResource);

        // now it should return consented resources
        resp = await request
            .get(
                `/4_0_0/Patient/?id=person.${masterPersonResource.id}&_rewritePatientReference=0&_bundle=1&_debug=1`
            )
            .set(client2Headers);
        expect(resp).toHaveResponse(expectedClient2ConsentPatientResource);
    });
});
