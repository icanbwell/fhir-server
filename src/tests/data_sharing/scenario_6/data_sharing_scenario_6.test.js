// This test case contains bwell master person & patient along with client person linked with master person.
// Client person is further linked with 4 patients: 1 client patient, 1 client_1 patient & 2 other patients[1 with id and other with uuid].
// All patients further have observations resources linked with.
// This file covers scoping scenarios for this data set (client vs client_1, patient-level scoping, ambiguous-id errors).
// The additional patients are included as unrelated background data in some scenarios below.

const masterPersonResource = require('./fixtures/person/master_person.json');
const clientPersonResource = require('./fixtures/person/client_person.json');
const masterPatientResource = require('./fixtures/patient/master_patient.json');
const clientPatientResource = require('./fixtures/patient/client_patient.json');
const clientPatient1Resource = require('./fixtures/patient/client_patient_1.json');
const otherPatientResource = require('./fixtures/patient/other_patient.json');
const clientObservationResource = require('./fixtures/observation/client_observation.json');
const clientObservation1Resource = require('./fixtures/observation/client_observation_1.json');
const otherObservationResource = require('./fixtures/observation/other_observation.json');
const otherPatient1Resource = require('./fixtures/patient/other_patient1.json');
const otherObservation1Resource = require('./fixtures/observation/other_observation1.json');
const otherPatient2Resource = require('./fixtures/patient/other_patient2.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, jest, expect } = require('@jest/globals');
const { DatabaseCursor } = require('../../../dataLayer/databaseCursor');

const headers = getHeaders('user/*.read access/client.*');
const client1Headers = getHeaders('user/*.read access/client1.*');
const client_1Headers = getHeaders('user/*.read access/client_1.*');

describe('Data sharing test cases for different scenarios', () => {
    const cursorSpy = jest.spyOn(DatabaseCursor.prototype, 'hint');

    beforeEach(async () => {
        cursorSpy.mockReturnThis();
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Data sharing scenario - 6', () => {
        test('Ref of master person: Get Client patient data only, when other patient data not created yet', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource, clientPatient1Resource,
                    clientObservationResource, clientObservation1Resource, otherPatientResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/person.08f1b73a-e27c-456d-8a61-277f164a9a57')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(2);
            expect(respIds).toEqual(expect.arrayContaining([
                clientObservationResource.id, clientObservation1Resource.id
            ]));
        });

        test('Ref of master person: Get client_1 patient data only as client_1 header provided', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource, clientPatient1Resource,
                    clientObservationResource, clientObservation1Resource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/person.08f1b73a-e27c-456d-8a61-277f164a9a57')
                .set(client_1Headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(1);
            expect(respIds).toEqual([clientObservation1Resource.id]);
        });

        test('Ref of client person: Different access token: No data should be there', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource, clientPatient1Resource,
                    clientObservationResource, clientObservation1Resource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/person.c12345')
                .set(client1Headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(0);
        });

        test('Ref of client patient: Only data of client patient must be returned', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource, clientPatient1Resource,
                    clientObservationResource, clientObservation1Resource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/bb7862e6-b7ac-470e-bde3-e85cee9d1ce6')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(1);
            expect(respIds).toEqual([clientObservationResource.id]);
        });

        test('Ref of client patient 1: Only data of client patient must be returned', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource, clientPatient1Resource,
                    clientObservationResource, clientObservation1Resource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/bb7872e6-b7ac-470e-bde3-e85cee9d1ce6')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(1);
            expect(respIds).toEqual([clientObservation1Resource.id]);
        });

        test('Ref of other patient 1(id only): Error should be received as 2 patients exists with provided patient id', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource, clientPatient1Resource,
                    clientObservationResource, clientObservation1Resource, otherPatientResource, otherObservationResource,
                    otherPatient1Resource, otherObservation1Resource, otherPatient2Resource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/333')
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(400);
        });
    });
});
