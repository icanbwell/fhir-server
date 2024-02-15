// This test case contains bwell master person & patient along with client person linked with master person.
// Client person is further linked with 4 patients: 1 client patient, 1 client_1 patient & 2 hipaa patient[1 with id and other with uuid].
// All patients further have observations resources linked with.
// This file covers all possible scenarios of this data set, mainly that data with connection type hipaa must be available to client,
// even without consent.

const masterPersonResource = require('./fixtures/person/master_person.json');
const clientPersonResource = require('./fixtures/person/client_person.json');
const masterPatientResource = require('./fixtures/patient/master_patient.json');
const clientPatientResource = require('./fixtures/patient/client_patient.json');
const clientPatient1Resource = require('./fixtures/patient/client_patient_1.json');
const hipaaPatientResource = require('./fixtures/patient/hipaa_patient.json');
const clientObservationResource = require('./fixtures/observation/client_observation.json');
const clientObservation1Resource = require('./fixtures/observation/client_observation_1.json');
const hipaaObservationResource = require('./fixtures/observation/hipaa_observation.json');
const hipaaPatient1Resource = require('./fixtures/patient/hipaa_patient1.json');
const hipaaObservation1Resource = require('./fixtures/observation/hipaa_observation1.json');
const hipaaPatient2Resource = require('./fixtures/patient/hipaa_patient2.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');
const {describe, beforeEach, afterEach, test, jest, expect} = require('@jest/globals');
const { DatabasePartitionedCursor } = require('../../../dataLayer/databasePartitionedCursor');

const headers = getHeaders('user/*.read access/client.*');
const client1Headers = getHeaders('user/*.read access/client1.*');
const client_1Headers = getHeaders('user/*.read access/client_1.*');

describe('Data sharing test cases for different scenarios', () => {
    const cursorSpy = jest.spyOn(DatabasePartitionedCursor.prototype, 'hint');

    beforeEach(async () => {
        cursorSpy.mockReturnThis();
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Data sharing scenario - 6', () => {
        test('Ref of master person: Get Client patient data only, when hipaa data not created yet', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource, clientPatient1Resource,
                    clientObservationResource, clientObservation1Resource, hipaaPatientResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/person.08f1b73a-e27c-456d-8a61-277f164a9a57')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(2);
            expect(respIds).toEqual(expect.arrayContaining([
                clientObservationResource.id, clientObservation1Resource.id
            ]));
        });

        test('Ref of master person: Get Client patient data along with hipaa data, regardless of consent provided', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource, clientPatient1Resource,
                    clientObservationResource, clientObservation1Resource, hipaaPatientResource, hipaaObservationResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/person.08f1b73a-e27c-456d-8a61-277f164a9a57,90')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(3);
            expect(respIds).toEqual(expect.arrayContaining([
                clientObservationResource.id, clientObservation1Resource.id, hipaaObservationResource.id
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
                    clientObservationResource, clientObservation1Resource, hipaaPatientResource, hipaaObservationResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/person.08f1b73a-e27c-456d-8a61-277f164a9a57')
                .set(client_1Headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(1);
            expect(respIds).toEqual([clientObservation1Resource.id]);
        });

        test('Ref of client person: Get Client patient data along with hipaa data, regardless of consent provided', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource, clientPatient1Resource,
                    clientObservationResource, clientObservation1Resource, hipaaPatientResource, hipaaObservationResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/person.c12345')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(3);
            expect(respIds).toEqual(expect.arrayContaining(
                [clientObservationResource.id, clientObservation1Resource.id, hipaaObservationResource.id]
            ));
        });

        test('Ref of client person(uuid): Get Client patient data along with hipaa data, regardless of consent provided', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource, clientPatient1Resource,
                    clientObservationResource, clientObservation1Resource, hipaaPatientResource, hipaaObservationResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/person.33226ded-51e8-590e-8342-1197955a2af7')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(3);
            expect(respIds).toEqual(expect.arrayContaining(
                [clientObservationResource.id, clientObservation1Resource.id, hipaaObservationResource.id]
            ));
        });

        test('Ref of client person: Different access token: No data should be there', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource, clientPatient1Resource,
                    clientObservationResource, clientObservation1Resource, hipaaPatientResource, hipaaObservationResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

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
                    clientObservationResource, clientObservation1Resource, hipaaPatientResource, hipaaObservationResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

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
                    clientObservationResource, clientObservation1Resource, hipaaPatientResource, hipaaObservationResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/bb7872e6-b7ac-470e-bde3-e85cee9d1ce6')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(1);
            expect(respIds).toEqual([clientObservation1Resource.id]);
        });

        test('Ref of hipaa patient: Only data of hipaa patient must be returned', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource, clientPatient1Resource,
                    clientObservationResource, clientObservation1Resource, hipaaPatientResource, hipaaObservationResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/fde7f82b-b1e4-4a25-9a58-83b6921414cc')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(1);
            expect(respIds).toEqual([hipaaObservationResource.id]);
        });

        test('Ref of hipaa patient 1(uuid): Get hipaa observation linked with ID', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource, clientPatient1Resource,
                    clientObservationResource, clientObservation1Resource, hipaaPatientResource, hipaaObservationResource,
                    hipaaPatient1Resource, hipaaObservation1Resource, hipaaPatient2Resource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/ce0d61c6-a3d8-51e1-88ac-85eb5f2be4b6')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(1);
            expect(respIds).toEqual([hipaaObservation1Resource.id]);
        });

        test('Ref of hipaa patient 1(id & source assigning authority): Get hipaa observation linked with ID', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource, clientPatient1Resource,
                    clientObservationResource, clientObservation1Resource, hipaaPatientResource, hipaaObservationResource,
                    hipaaPatient1Resource, hipaaObservation1Resource, hipaaPatient2Resource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/333|client-1')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(1);
            expect(respIds).toEqual([hipaaObservation1Resource.id]);
        });

        test('Ref of hipaa patient 1(id only): Get hipaa observation linked with ID', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource, clientPatient1Resource,
                    clientObservationResource, clientObservation1Resource, hipaaPatientResource, hipaaObservationResource,
                    hipaaPatient1Resource, hipaaObservation1Resource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/333')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(1);
            expect(respIds).toEqual([hipaaObservation1Resource.id]);
        });

        test('Ref of hipaa patient 1(id only): Error should be received as 2 patients exists with provided patient id', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource, clientPatient1Resource,
                    clientObservationResource, clientObservation1Resource, hipaaPatientResource, hipaaObservationResource,
                    hipaaPatient1Resource, hipaaObservation1Resource, hipaaPatient2Resource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/333')
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(400);
        });
    });
});
