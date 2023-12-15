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

const proaIDPatientResource = require('./fixtures/patient/proa_id_patient.json');
const proaIDObservationResource = require('./fixtures/observation/proa_id_observation.json');

const duplicateClientPatientResource = require('./fixtures/patient/duplicate_client_patient.json');
const duplicateClientObservationResource = require('./fixtures/observation/duplicate_client_observation.json');

const hipaaPatientResource = require('./fixtures/patient/hipaa_patient.json');
const hipaaObservation1Resource = require('./fixtures/observation/hipaa_observation_1.json');
const proaObservation2Resource = require('./fixtures/observation/proa_observation_2.json');

const hipaaPatient1Resource = require('./fixtures/patient/hipaa_patient1.json');
const hipaaPatient2Resource = require('./fixtures/patient/hipaa_patient2.json');

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

        test('Ref of master person: Get hipaa data only for hipaa patient, and not for proa patient', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource, proaPatientResource,
                    clientObservationResource, proaObservationResource, hipaaObservationResource, clientNonLinkedObservationResource,
                    hipaaPatientResource, hipaaObservation1Resource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/person.08f1b73a-e27c-456d-8a61-277f164a9a57')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(2);
            expect(respIds).toEqual(expect.arrayContaining([clientObservationResource.id, hipaaObservation1Resource.id]));
        });

        test('Ref of master person: Get hipaa & proa data both, when consent provided', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    proaPatientResource, clientObservationResource, proaObservationResource, hipaaObservationResource,
                    consentGivenResource, proaObservation1Resource, hipaaPatientResource, hipaaObservation1Resource])
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

        test('Ref of master person: Get hipaa & proa data both, when consent provided, here proa patient has id and not uuid', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    proaPatientResource, clientObservationResource, proaObservationResource, hipaaObservationResource,
                    consentGivenResource, proaObservation1Resource, hipaaPatientResource, hipaaObservation1Resource, proaIDPatientResource,
                    proaIDObservationResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/person.08f1b73a-e27c-456d-8a61-277f164a9a57')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(4);
            // Here client observation & hipaa, proa connection type observation & proa observation with ID are expected, and not the one with
            // different connection type linked to proaPatientResource.
            expect(respIds).toEqual(expect.arrayContaining(
                [clientObservationResource.id, hipaaObservationResource.id, proaObservationResource.id, proaIDObservationResource.id]
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
                    client1PersonResource, client1PatientResource, client1ObservationResource, hipaaPatientResource, hipaaObservation1Resource])
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
                    clientObservationResource, proaObservationResource, hipaaObservationResource, proaObservation2Resource,
                    hipaaPatientResource, hipaaObservation1Resource])
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

        test('Ref of client person: Get hipaa & proa data both, when consent provided', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource, proaPatientResource,
                    clientObservationResource, proaObservationResource, hipaaObservationResource, consentGivenResource,
                    hipaaPatientResource, hipaaObservation1Resource])
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
                    clientObservationResource, proaObservationResource, hipaaObservationResource, consentGivenResource,
                    hipaaPatientResource, hipaaObservation1Resource])
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

        test('Ref of proa patient: Get no data when no consent provided', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource, proaPatientResource,
                    clientObservationResource, proaObservationResource, hipaaObservationResource, hipaaPatientResource, hipaaObservation1Resource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/fde7f82b-b1e4-4a25-9a58-83b6921414cc')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(0);
        });

        test('Ref of proa patient: Get proa data only, when consent provided', async () => {
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

            expect(respIds.length).toEqual(1);
            expect(respIds).toEqual(expect.arrayContaining([proaObservationResource.id]));
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

        test('Ref of proa patient: Get proa observation with ID, when consent provided & proa patient searched with UUID', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    proaPatientResource, clientObservationResource, proaObservationResource, hipaaObservationResource,
                    consentGivenResource, proaObservation1Resource, hipaaPatientResource, hipaaObservation1Resource, proaIDPatientResource,
                    proaIDObservationResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/a9098577-9af1-53c6-a1ee-be268d9a6ae8')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(1);
            expect(respIds).toEqual(expect.arrayContaining([proaIDObservationResource.id]));
        });

        test('Ref of proa patient: Get proa observation with ID, when consent provided & proa patient searched with id & source assigning authority', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    proaPatientResource, clientObservationResource, proaObservationResource, hipaaObservationResource,
                    consentGivenResource, proaObservation1Resource, hipaaPatientResource, hipaaObservation1Resource, proaIDPatientResource,
                    proaIDObservationResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/123456|proa')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(1);
            expect(respIds).toEqual(expect.arrayContaining([proaIDObservationResource.id]));
        });

        test('Ref of proa patient: Get proa observation with ID, when consent provided & proa patient searched with id only', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    proaPatientResource, clientObservationResource, proaObservationResource, hipaaObservationResource,
                    consentGivenResource, proaObservation1Resource, hipaaPatientResource, hipaaObservation1Resource, proaIDPatientResource,
                    proaIDObservationResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/123456')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(1);
            expect(respIds).toEqual(expect.arrayContaining([proaIDObservationResource.id]));
        });

        test('Ref of proa patient: Get 400 when no source assigning authority provided and multiple patients of provided id exists.', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    proaPatientResource, clientObservationResource, proaObservationResource, hipaaObservationResource,
                    consentGivenResource, proaObservation1Resource, hipaaPatientResource, hipaaObservation1Resource, proaIDPatientResource,
                    proaIDObservationResource, duplicateClientPatientResource, duplicateClientObservationResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/123456')
                .set(headers);

            expect(resp).toHaveStatusCode(400);
        });

        test('Ref of proa patient & duplicate patient with source respective source assigning authority: Get Observations of both patients.', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    proaPatientResource, clientObservationResource, proaObservationResource, hipaaObservationResource,
                    consentGivenResource, proaObservation1Resource, hipaaPatientResource, hipaaObservation1Resource, proaIDPatientResource,
                    proaIDObservationResource, duplicateClientPatientResource, duplicateClientObservationResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/123456|proa,Patient/123456|client')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(2);
            expect(respIds).toEqual(expect.arrayContaining([proaIDObservationResource.id, duplicateClientObservationResource.id]));
        });

        test('Ref of client patient: Get observation of client patient only and not proa, even it has same ID.', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    proaPatientResource, clientObservationResource, proaObservationResource, hipaaObservationResource,
                    consentGivenResource, proaObservation1Resource, hipaaPatientResource, hipaaObservation1Resource, proaIDPatientResource,
                    proaIDObservationResource, duplicateClientPatientResource, duplicateClientObservationResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/123456|client')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(1);
            expect(respIds).toEqual([duplicateClientObservationResource.id]);
        });

        test('Ref of proa patient: Get observation of proa patient only and not client, even it has same ID.', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    proaPatientResource, clientObservationResource, proaObservationResource, hipaaObservationResource,
                    consentGivenResource, proaObservation1Resource, hipaaPatientResource, hipaaObservation1Resource, proaIDPatientResource,
                    proaIDObservationResource, duplicateClientPatientResource, duplicateClientObservationResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/123456|proa')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(1);
            expect(respIds).toEqual(expect.arrayContaining([proaIDObservationResource.id]));
        });

        test('Ref of hipaa patient 1(uuid): Get patient data even without consent.', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    proaPatientResource, clientObservationResource, proaObservationResource, hipaaObservationResource,
                    proaObservation1Resource, hipaaPatientResource, hipaaObservation1Resource, proaIDPatientResource,
                    proaIDObservationResource, duplicateClientPatientResource, duplicateClientObservationResource,
                    hipaaPatient1Resource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/patient?id=bb7862e6-b7ac-470e-bde3-e85cee9d1ca7')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(1);
            expect(respIds).toEqual([hipaaPatient1Resource.id]);
        });

        test('Ref of hipaa patient 2: Get patient data even without consent.', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    proaPatientResource, clientObservationResource, proaObservationResource, hipaaObservationResource,
                    proaObservation1Resource, hipaaPatientResource, hipaaObservation1Resource, proaIDPatientResource,
                    proaIDObservationResource, duplicateClientPatientResource, duplicateClientObservationResource,
                    hipaaPatient1Resource, hipaaPatient2Resource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/patient?id=223344')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(1);
            expect(respIds).toEqual([hipaaPatient2Resource.id]);
        });

        test('Ref of hipaa patient 2(with source assigning authority): Get patient data even without consent.', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    proaPatientResource, clientObservationResource, proaObservationResource, hipaaObservationResource,
                    proaObservation1Resource, hipaaPatientResource, hipaaObservation1Resource, proaIDPatientResource,
                    proaIDObservationResource, duplicateClientPatientResource, duplicateClientObservationResource,
                    hipaaPatient1Resource, hipaaPatient2Resource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/patient?id=223344|abc')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(1);
            expect(respIds).toEqual([hipaaPatient2Resource.id]);
        });
    });
});
