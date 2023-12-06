const masterPersonResource = require('./fixtures/person/master_person.json');
const masterPatientResource = require('./fixtures/patient/master_patient.json');

const clientPersonResource = require('./fixtures/person/client_person.json');
const clientPatientResource = require('./fixtures/patient/client_patient.json');
const clientObservationResource = require('./fixtures/observation/client_observation.json');
const clientNonLinkedObservationResource = require('./fixtures/observation/client_non_linked_observation.json');

const proaPatientResource = require('./fixtures/patient/proa_patient.json');
const proaObservationResource = require('./fixtures/observation/proa_observation.json');
const proaObservation1Resource = require('./fixtures/observation/proa_observation_1.json');
const hipaaObservationResource = require('./fixtures/observation/hipaa_observation.json');

const client1PersonResource = require('./fixtures/person/client_1_person.json');
const client1PatientResource = require('./fixtures/patient/client_1_patient.json');
const client1ObservationResource = require('./fixtures/observation/client_1_observation.json');

const consentGivenResource = require('./fixtures/consent/consent_given.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');
const { DatabasePartitionedCursor } = require('../../../dataLayer/databasePartitionedCursor');


const headers = getHeaders('user/*.read access/client.*');
const client1Headers = getHeaders('user/*.read access/client-1.*');

describe('Consent Based Data Access Along With HIE Treatment Data Test', () => {
    const cursorSpy = jest.spyOn(DatabasePartitionedCursor.prototype, 'hint');

    beforeEach(async () => {
        cursorSpy.mockReturnThis();
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Observation Resource data read by Client Credentials', () => {
        test('Ref of master person: Get Client patient data only, hipaa data not created yet', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource, proaPatientResource,
                    clientObservationResource, proaObservationResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/person.08f1b73a-e27c-456d-8a61-277f164a9a57')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(1);
            expect(respIds).toEqual(expect.arrayContaining([clientObservationResource.id]));
        });

        test('Ref of master person: Get hipaa data only for proa patient, even without consent for proa patient', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource, proaPatientResource,
                    clientObservationResource, proaObservationResource, hipaaObservationResource, clientNonLinkedObservationResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/person.08f1b73a-e27c-456d-8a61-277f164a9a57')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(2);
            expect(respIds).toEqual(expect.arrayContaining([clientObservationResource.id, hipaaObservationResource.id]));
        });

        test('Ref of master person: Get hipaa & proa data for proa patient, when consent provided', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    proaPatientResource, clientObservationResource, proaObservationResource, hipaaObservationResource,
                    consentGivenResource, proaObservation1Resource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/person.08f1b73a-e27c-456d-8a61-277f164a9a57')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(3);
            // Here client observation & hipaa, proa connection type observations are expected, and not the one with
            // different connection type linked to proaPatientResource
            expect(respIds).toEqual(expect.arrayContaining(
                [clientObservationResource.id, hipaaObservationResource.id, proaObservationResource.id]
            ));
        });

        test('Ref of master person: Get data for client-1 patient only, when access token for client-1 provided', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource, proaPatientResource,
                    clientObservationResource, proaObservationResource, hipaaObservationResource, consentGivenResource,
                    client1PersonResource, client1PatientResource, client1ObservationResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/person.08f1b73a-e27c-456d-8a61-277f164a9a57')
                .set(client1Headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(1);
            expect(respIds).toEqual(expect.arrayContaining([client1ObservationResource.id]));
        });

        test('Ref of client person: Get hipaa data only for proa patient, even without consent for proa patient', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource, proaPatientResource,
                    clientObservationResource, proaObservationResource, hipaaObservationResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/person.c12345')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(2);
            expect(respIds).toEqual(expect.arrayContaining([clientObservationResource.id, hipaaObservationResource.id]));
        });

        test('Ref of client person: Get hipaa & proa data for proa patient, when consent provided', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource, proaPatientResource,
                    clientObservationResource, proaObservationResource, hipaaObservationResource, consentGivenResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/person.c12345')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(3);
            expect(respIds).toEqual(expect.arrayContaining(
                [clientObservationResource.id, hipaaObservationResource.id, proaObservationResource.id]
            ));
        });

        test('Ref of client person: Different access token: No data should be there', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource, proaPatientResource,
                    clientObservationResource, proaObservationResource, hipaaObservationResource, consentGivenResource])
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
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource, proaPatientResource,
                    clientObservationResource, proaObservationResource, hipaaObservationResource, consentGivenResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/bb7862e6-b7ac-470e-bde3-e85cee9d1ce6')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(1);
            expect(respIds).toEqual(expect.arrayContaining([clientObservationResource.id]));
        });

        test('Ref of proa patient: Get hipaa data only, even without consent', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource, proaPatientResource,
                    clientObservationResource, proaObservationResource, hipaaObservationResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/fde7f82b-b1e4-4a25-9a58-83b6921414cc')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(1);
            expect(respIds).toEqual(expect.arrayContaining([hipaaObservationResource.id]));
        });

        test('Ref of proa patient: Get hipaa & proa data, when consent provided', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource, proaPatientResource,
                    clientObservationResource, proaObservationResource, hipaaObservationResource, consentGivenResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/fde7f82b-b1e4-4a25-9a58-83b6921414cc')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(2);
            expect(respIds).toEqual(expect.arrayContaining([hipaaObservationResource.id, proaObservationResource.id]));
        });

        test('Ref of client-1 person: no data for other client should be there, regardless of consent', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource, proaPatientResource,
                    clientObservationResource, proaObservationResource, hipaaObservationResource, consentGivenResource,
                    client1PersonResource, client1PatientResource, client1ObservationResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/person.bdc02b42-ad3a-4e8b-a607-6210316cf58e')
                .set(client1Headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(1);
            expect(respIds).toEqual(expect.arrayContaining([client1ObservationResource.id]));
        });
    });
});
