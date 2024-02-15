// This test case contains bwell master person & patient along with client person and client-1 person linked with master person.
// Client person is further linked with 1 client patient.
// Client-1 person is further linked with 3 client-1 patient.
// All patients further have observations resources linked with.
// Here note that even if consent is provided, normal & hipaa data of 'client-1' is not fetched from 'client' as they do not have
// the same immediate client person.

const masterPersonResource = require('./fixtures/person/master_person.json');
const masterPatientResource = require('./fixtures/patient/master_patient.json');

const clientPersonResource = require('./fixtures/person/client_person.json');
const clientPatientResource = require('./fixtures/patient/client_patient.json');
const clientObservationResource = require('./fixtures/observation/client_observation.json');

const client1PersonResource = require('./fixtures/person/client_1_person.json');
const client1PatientResource = require('./fixtures/patient/client_1_patient.json');
const hipaaObservationResource = require('./fixtures/observation/hipaa_observation.json');

const client1Patient1Resource = require('./fixtures/patient/client_1_patient1.json');
const client1ObservationResource = require('./fixtures/observation/client_1_observation.json');
const client1Patient2Resource = require('./fixtures/patient/client_1_patient2.json');
const client1Observation1Resource = require('./fixtures/observation/client_1_observation1.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');
const {describe, beforeEach, afterEach, test, jest, expect} = require('@jest/globals');
const { DatabasePartitionedCursor } = require('../../../dataLayer/databasePartitionedCursor');

const headers = getHeaders('user/*.read access/client.*');
const client1Headers = getHeaders('user/*.read access/client-1.*');

describe('Data sharing test cases for different scenarios', () => {
    const cursorSpy = jest.spyOn(DatabasePartitionedCursor.prototype, 'hint');

    beforeEach(async () => {
        cursorSpy.mockReturnThis();
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Data Sharing Scenario - 7b', () => {
        test('Ref of master person: Get Client patient data only, no hipaa data as no no linking with client person', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    clientObservationResource, client1PersonResource, client1PatientResource,
                    hipaaObservationResource, client1Patient1Resource, client1ObservationResource, client1Patient2Resource,
                    client1Observation1Resource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/person.08f1b73a-e27c-456d-8a61-277f164a9a57')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(1);
            expect(respIds).toEqual([clientObservationResource.id]);
        });

        test('Ref of master person: Get all client-1 observations, as client-1 header is provided', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    clientObservationResource, client1PersonResource, client1PatientResource,
                    hipaaObservationResource, client1Patient1Resource, client1ObservationResource,
                    client1Patient2Resource, client1Observation1Resource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/person.08f1b73a-e27c-456d-8a61-277f164a9a57')
                .set(client1Headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(3);
            expect(respIds).toEqual(expect.arrayContaining(
                [hipaaObservationResource.id, client1ObservationResource.id, client1Observation1Resource.id]
            ));
        });

        test('Ref of client person: Get client observation only', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    clientObservationResource, client1PersonResource, client1PatientResource, hipaaObservationResource,
                    client1Patient1Resource, client1ObservationResource, client1Patient2Resource, client1Observation1Resource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/person.c12345')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(1);
            expect(respIds).toEqual(([clientObservationResource.id]));
        });

        test('Ref of client person(uuid): Get client observation only', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    clientObservationResource, client1PersonResource, client1PatientResource,
                    hipaaObservationResource, client1Patient1Resource, client1ObservationResource, client1Patient2Resource,
                    client1Observation1Resource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/person.33226ded-51e8-590e-8342-1197955a2af7')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(1);
            expect(respIds).toEqual([clientObservationResource.id]);
        });

        test('Ref of client person: Different access token: No data should be there', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    clientObservationResource, client1PersonResource, client1PatientResource,
                    hipaaObservationResource, client1Patient1Resource, client1ObservationResource,
                    client1Patient2Resource, client1Observation1Resource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/person.c12345')
                .set(client1Headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(0);
        });

        test('Ref of client patient: Only data of client patient must be returned, regardless of consent', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    clientObservationResource, client1PersonResource, client1PatientResource,
                    hipaaObservationResource, client1Patient1Resource, client1ObservationResource,
                    client1Patient2Resource, client1Observation1Resource])
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

        test('Ref of client-1 proxy-person: Get all client-1 observations, as client-1 header is provided', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    clientObservationResource, client1PersonResource, client1PatientResource,
                    hipaaObservationResource, client1Patient1Resource, client1ObservationResource,
                    client1Patient2Resource, client1Observation1Resource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/person.c123456')
                .set(client1Headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(3);
            expect(respIds).toEqual(expect.arrayContaining(
                [hipaaObservationResource.id, client1ObservationResource.id, client1Observation1Resource.id]
            ));
        });

        test('Ref of client-1 patient: No data as different access token', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    clientObservationResource, client1PersonResource, client1PatientResource,
                    hipaaObservationResource, client1Patient1Resource, client1ObservationResource,
                    client1Patient2Resource, client1Observation1Resource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/bb7762e6-b7ac-470e-bde3-e85cee9d1ce6')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(0);
        });

        test('Ref of client-1 patient: Get client-1 patient observation(hipaa) only, as client-1 header provided', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    clientObservationResource, client1PersonResource, client1PatientResource,
                    hipaaObservationResource, client1Patient1Resource, client1ObservationResource,
                    client1Patient2Resource, client1Observation1Resource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/bb7762e6-b7ac-470e-bde3-e85cee9d1ce6')
                .set(client1Headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(1);
            expect(respIds).toEqual([hipaaObservationResource.id]);
        });

        test('Ref of client-1 patient 1: Get client-1 patient 1 observation only, as client-1 header provided', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    clientObservationResource, client1PersonResource, client1PatientResource,
                    hipaaObservationResource, client1Patient1Resource, client1ObservationResource,
                    client1Patient2Resource, client1Observation1Resource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/bb7762e6-b7ac-470e-bde3-e85cee9d1ce7')
                .set(client1Headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(1);
            expect(respIds).toEqual([client1ObservationResource.id]);
        });

        test('Ref of client-1 patient 2: Get client-1 patient 2 observation only, as client-1 header provided', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    clientObservationResource, client1PersonResource, client1PatientResource,
                    hipaaObservationResource, client1Patient1Resource, client1ObservationResource,
                    client1Patient2Resource, client1Observation1Resource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/bb7762e6-b7ac-470e-bde3-e85cee9d1ce8')
                .set(client1Headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(1);
            expect(respIds).toEqual([client1Observation1Resource.id]);
        });
    });
});
