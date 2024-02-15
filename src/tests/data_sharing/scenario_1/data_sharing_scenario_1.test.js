// This test case contains bwell master person & patient along with client person linked with master person.
// Client person is further linked with 4 patients: 1 client patient, 1 client_1 patient & 2 proa patient.
// All patients further have observations resources linked with.
// This file covers all possible scenarios of this data set, including where consent is included & not included.

const masterPersonResource = require('./fixtures/person/master_person.json');
const clientPersonResource = require('./fixtures/person/client_person.json');
const masterPatientResource = require('./fixtures/patient/master_patient.json');
const clientPatientResource = require('./fixtures/patient/client_patient.json');
const clientPatient1Resource = require('./fixtures/patient/client_patient_1.json');
const proaPatientResource = require('./fixtures/patient/proa_patient.json');
const clientObservationResource = require('./fixtures/observation/client_observation.json');
const clientObservation1Resource = require('./fixtures/observation/client_observation_1.json');
const proaObservationResource = require('./fixtures/observation/proa_observation.json');

const proaPatient1Resource = require('./fixtures/patient/proa_patient1.json');
const proaObservation1Resource = require('./fixtures/observation/proa_observation1.json');

const activityDefinitionResource = require('./fixtures/activity_definition/activity_definition_resource.json');

const consentGivenResource = require('./fixtures/consent/consent_given.json');
const consentDeniedResource = require('./fixtures/consent/consent_denied.json');

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

    describe('Data sharing scenario - 1', () => {
        test('Ref of master person: Get Client patient data only, no proa data as no consent provided', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource, proaPatientResource,
                    clientPatient1Resource, clientObservationResource, clientObservation1Resource, proaObservationResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/person.08f1b73a-e27c-456d-8a61-277f164a9a57')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(2);
            expect(respIds).toEqual(expect.arrayContaining([clientObservationResource.id, clientObservation1Resource.id]));
        });

        test('Ref of master person: Get Client patient data only, no proa data as consent denied provided', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource, proaPatientResource,
                    clientPatient1Resource, clientObservationResource, clientObservation1Resource, proaObservationResource,
                    consentDeniedResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/person.08f1b73a-e27c-456d-8a61-277f164a9a57')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(2);
            expect(respIds).toEqual(expect.arrayContaining([clientObservationResource.id, clientObservation1Resource.id]));
        });

        test('Ref of master person: Get Client patient & proa patient data, consent provided', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource, proaPatientResource,
                    clientPatient1Resource, clientObservationResource, clientObservation1Resource, proaObservationResource,
                    consentGivenResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/person.08f1b73a-e27c-456d-8a61-277f164a9a57')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(3);
            expect(respIds).toEqual(expect.arrayContaining([
                clientObservationResource.id, clientObservation1Resource.id, proaObservationResource.id
            ]));
        });

        test('Ref of master person: Get client_1 patient data only as client_1 header provided', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource, proaPatientResource,
                    clientPatient1Resource, clientObservationResource, clientObservation1Resource, proaObservationResource,
                    consentGivenResource])
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

        test('Ref of master person: Get Client patient & proa patient data, consent provided, and later consent revoked.', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource, proaPatientResource,
                    clientPatient1Resource, clientObservationResource, clientObservation1Resource, proaObservationResource,
                    consentGivenResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/person.08f1b73a-e27c-456d-8a61-277f164a9a57')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(3);
            expect(respIds).toEqual(expect.arrayContaining([
                clientObservationResource.id, clientObservation1Resource.id, proaObservationResource.id
            ]));

            resp = await request.post('/4_0_0/Person/1/$merge').send([
                {...consentGivenResource, status: 'inactive'}, consentDeniedResource
                ]).set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({updated: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/person.08f1b73a-e27c-456d-8a61-277f164a9a57')
                .set(headers);
            const respIds1 = resp.body.map(item => item.id);

            expect(respIds1.length).toEqual(2);
            expect(respIds1).toEqual(expect.arrayContaining([
                clientObservationResource.id, clientObservation1Resource.id
            ]));
        });

        test('Ref of master person: Get client & proa data, when consent provided, here proa patient has id and not uuid', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource, proaPatientResource,
                    clientPatient1Resource, clientObservationResource, clientObservation1Resource, proaObservationResource,
                    consentGivenResource, proaPatient1Resource, proaObservation1Resource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/person.08f1b73a-e27c-456d-8a61-277f164a9a57')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(4);
            // Here client observations, proa connection type observation & proa observation with ID are expected
            expect(respIds).toEqual(expect.arrayContaining(
                [clientObservationResource.id, clientObservation1Resource.id, proaObservationResource.id, proaObservation1Resource.id]
            ));
        });

        test('Ref of client person: Get client only, when consent not provided', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource, proaPatientResource,
                    clientPatient1Resource, clientObservationResource, clientObservation1Resource, proaObservationResource,
                    proaPatient1Resource, proaObservation1Resource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/person.c12345')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(2);
            expect(respIds).toEqual(expect.arrayContaining(
                [clientObservationResource.id, clientObservation1Resource.id]
            ));
        });

        test('Ref of client person(uuid): Get client only, when consent not provided', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource, proaPatientResource,
                    clientPatient1Resource, clientObservationResource, clientObservation1Resource, proaObservationResource,
                    proaPatient1Resource, proaObservation1Resource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/person.33226ded-51e8-590e-8342-1197955a2af7')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(2);
            expect(respIds).toEqual(expect.arrayContaining(
                [clientObservationResource.id, clientObservation1Resource.id]
            ));
        });

        test('Ref of client person: Get client only, when consent denied provided', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource, proaPatientResource,
                    clientPatient1Resource, clientObservationResource, clientObservation1Resource, proaObservationResource,
                    consentDeniedResource, proaPatient1Resource, proaObservation1Resource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/person.c12345')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(2);
            expect(respIds).toEqual(expect.arrayContaining(
                [clientObservationResource.id, clientObservation1Resource.id]
            ));
        });

        test('Ref of client person(uuid): Get client only, when consent denied provided', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource, proaPatientResource,
                    clientPatient1Resource, clientObservationResource, clientObservation1Resource, proaObservationResource,
                    consentDeniedResource, proaPatient1Resource, proaObservation1Resource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/person.33226ded-51e8-590e-8342-1197955a2af7')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(2);
            expect(respIds).toEqual(expect.arrayContaining(
                [clientObservationResource.id, clientObservation1Resource.id]
            ));
        });

        test('Ref of client person: Get client & proa data both, when consent provided', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource, proaPatientResource,
                    clientPatient1Resource, clientObservationResource, clientObservation1Resource, proaObservationResource,
                    consentGivenResource, proaPatient1Resource, proaObservation1Resource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/person.c12345')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(4);
            expect(respIds).toEqual(expect.arrayContaining(
                [clientObservationResource.id, clientObservation1Resource.id, proaObservationResource.id, proaObservation1Resource.id]
            ));
        });

        test('Ref of client person(uuid): Get client & proa data both, when consent provided', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource, proaPatientResource,
                    clientPatient1Resource, clientObservationResource, clientObservation1Resource, proaObservationResource,
                    consentGivenResource, proaPatient1Resource, proaObservation1Resource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/person.33226ded-51e8-590e-8342-1197955a2af7')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(4);
            expect(respIds).toEqual(expect.arrayContaining(
                [clientObservationResource.id, clientObservation1Resource.id, proaObservationResource.id, proaObservation1Resource.id]
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
                    clientPatient1Resource, clientObservationResource, clientObservation1Resource, proaObservationResource,
                    consentGivenResource, proaPatient1Resource, proaObservation1Resource])
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
                    clientPatient1Resource, clientObservationResource, clientObservation1Resource, proaObservationResource,
                    consentGivenResource, proaPatient1Resource, proaObservation1Resource])
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

        test('Ref of client patient 1: Only data of client patient must be returned, regardless of consent', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource, proaPatientResource,
                    clientPatient1Resource, clientObservationResource, clientObservation1Resource, proaObservationResource,
                    consentGivenResource, proaPatient1Resource, proaObservation1Resource])
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

        test('Ref of proa patient: Get no data when no consent provided', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource, proaPatientResource,
                    clientPatient1Resource, clientObservationResource, clientObservation1Resource, proaObservationResource,
                    proaPatient1Resource, proaObservation1Resource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/fde7f82b-b1e4-4a25-9a58-83b6921414cc')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(0);
        });

        test('Ref of proa patient: Get no data when consent denied provided', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource, proaPatientResource,
                    clientPatient1Resource, clientObservationResource, clientObservation1Resource, proaObservationResource,
                    consentDeniedResource, proaPatient1Resource, proaObservation1Resource])
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
                    clientPatient1Resource, clientObservationResource, clientObservation1Resource, proaObservationResource,
                    consentGivenResource, proaPatient1Resource, proaObservation1Resource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/fde7f82b-b1e4-4a25-9a58-83b6921414cc')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(1);
            expect(respIds).toEqual([proaObservationResource.id]);
        });

        test('Ref of proa patient: Get proa observation with ID, when consent provided & proa patient searched with UUID', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource, proaPatientResource,
                    clientPatient1Resource, clientObservationResource, clientObservation1Resource, proaObservationResource,
                    consentGivenResource, proaPatient1Resource, proaObservation1Resource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/0c877e59-5987-5350-8d71-fb70d659de06')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(1);
            expect(respIds).toEqual([proaObservation1Resource.id]);
        });

        test('Ref of proa patient: Get proa observation with ID, when consent provided & proa patient searched with id & source assigning authority', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource, proaPatientResource,
                    clientPatient1Resource, clientObservationResource, clientObservation1Resource, proaObservationResource,
                    consentGivenResource, proaPatient1Resource, proaObservation1Resource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/123456|client-1')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(1);
            expect(respIds).toEqual([proaObservation1Resource.id]);
        });

        test('Ref of proa patient: Get proa observation with ID, when consent provided & proa patient searched with id only', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource, proaPatientResource,
                    clientPatient1Resource, clientObservationResource, clientObservation1Resource, proaObservationResource,
                    consentGivenResource, proaPatient1Resource, proaObservation1Resource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation?patient=Patient/123456')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(1);
            expect(respIds).toEqual([proaObservation1Resource.id]);
        });

        test('Search for ActivityDefinition resource which is not a patient related resource', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request.post('/4_0_0/ActivityDefinition/$merge').send([activityDefinitionResource]).set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/ActivityDefinition')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(1);
        });

        test('Search for Observation resource without patient in query param', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request.post('/4_0_0/ActivityDefinition/$merge').send([clientObservationResource]).set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Observation')
                .set(headers);
            const respIds = resp.body.map(item => item.id);

            expect(respIds.length).toEqual(1);
        });
    });
});
