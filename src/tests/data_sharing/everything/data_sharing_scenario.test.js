// This test case contains bwell master person & patient along with client person and client-1 person linked with master person.
// Client person is further linked with 4 client patients[2 of them are proa patient, & 1 is hie patient].
// Client-1 person is further linked with 2 patients[1 of them is proa patient].
// All patients further have observations resources linked with.
// Here we will test the data for $everything endpoint for different cases.

const masterPersonResource = require('./fixtures/person/master_person.json');
const masterPatientResource = require('./fixtures/patient/master_patient.json');

const clientPersonResource = require('./fixtures/person/client_person.json');
const clientPatientResource = require('./fixtures/patient/client_patient.json');
const clientObservationResource = require('./fixtures/observation/client_observation.json');

const client1PersonResource = require('./fixtures/person/client_1_person.json');
const client1PatientResource = require('./fixtures/patient/client_1_patient.json');
const client1ObservationResource = require('./fixtures/observation/client_1_observation.json');

const proaPatient1Resource = require('./fixtures/patient/proa_patient_1.json');
const proaObservation1Resource = require('./fixtures/observation/proa_observation_1.json');
const proaPatient2Resource = require('./fixtures/patient/proa_patient_2.json');
const proaObservation2Resource = require('./fixtures/observation/proa_observation_2.json');

const hieTreatmentPatientResource = require('./fixtures/patient/hie_patient.json');
const hieTreatmentObservationResource = require('./fixtures/observation/hie_observation.json');

const clientConsentGivenResource = require('./fixtures/consent/client_consent_given.json');
const clientConsentDeniedResource = require('./fixtures/consent/client_consent_denied.json');

const expectedResponse1Resource = require('./fixtures/expected/expected_response_1.json');
const expectedResponse2Resource = require('./fixtures/expected/expected_response_2.json');
const expectedResponse3Resource = require('./fixtures/expected/expected_response_3.json');
const expectedResponse4Resource = require('./fixtures/expected/expected_response_4.json');
const expectedResponse5Resource = require('./fixtures/expected/expected_response_5.json');
const expectedResponse6Resource = require('./fixtures/expected/expected_response_6.json');
const expectedResponse7Resource = require('./fixtures/expected/expected_response_7.json');
const expectedResponse7Resource1 = require('./fixtures/expected/expected_response_7_1.json');
const expectedResponse8Resource = require('./fixtures/expected/expected_response_8.json');
const expectedResponse9Resource = require('./fixtures/expected/expected_response_9.json');
const expectedResponse10Resource = require('./fixtures/expected/expected_response_10.json');
const expectedResponse11Resource = require('./fixtures/expected/expected_response_11.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, jest, expect } = require('@jest/globals');
const { DatabaseCursor } = require('../../../dataLayer/databaseCursor');

const headers = getHeaders('user/*.read access/client.*');
const client1Headers = getHeaders('user/*.read access/client-1.*');
const healthServiceHeader = getHeaders('user/*.read access/health-service.*');
const healthService1Header = getHeaders('user/*.read access/health-service-1.*');
const healthService2Header = getHeaders('user/*.read access/health-service-2.*');

describe('Data sharing test cases for different scenarios', () => {
    const cursorSpy = jest.spyOn(DatabaseCursor.prototype, 'hint');

    beforeEach(async () => {
        cursorSpy.mockReturnThis();
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Data Sharing Scenario for everything endpoint', () => {
        test('Everything operation on client person: Get client & hie data only & no proa data. when consent not provided', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    clientObservationResource, client1PersonResource, client1PatientResource, client1ObservationResource,
                    proaPatient1Resource, proaObservation1Resource, proaPatient2Resource, proaObservation2Resource,
                    hieTreatmentPatientResource, hieTreatmentObservationResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Person/c12345/$everything?_debug=true')
                .set({
                    ...headers,
                    prefer: 'global_id=false'
                });

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMongoQuery(expectedResponse1Resource);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse1Resource);
        });

        test('Everything operation on client person: Get client and hie data only, & no proa data, when consent denied', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    clientObservationResource, client1PersonResource, client1PatientResource, client1ObservationResource,
                    proaPatient1Resource, proaObservation1Resource, proaPatient2Resource, proaObservation2Resource,
                    hieTreatmentPatientResource, hieTreatmentObservationResource, clientConsentDeniedResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Person/c12345/$everything')
                .set({
                    ...headers,
                    prefer: 'global_id=false'
                });

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse2Resource);
        });

        test('Everything operation on client person: Get client, proa & hie patient data, when consent provided', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    clientObservationResource, client1PersonResource, client1PatientResource, client1ObservationResource,
                    proaPatient1Resource, proaObservation1Resource, proaPatient2Resource, proaObservation2Resource,
                    hieTreatmentPatientResource, hieTreatmentObservationResource, clientConsentGivenResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Person/c12345/$everything?_debug=true')
                .set({
                    ...headers,
                    prefer: 'global_id=false'
                });

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse3Resource);
        });

        test('Everything operation on client person: Get data only for proa patient when access token of proa patient provided & no consent provided', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    clientObservationResource, client1PersonResource, client1PatientResource, client1ObservationResource,
                    proaPatient1Resource, proaObservation1Resource, proaPatient2Resource, proaObservation2Resource,
                    hieTreatmentPatientResource, hieTreatmentObservationResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Person/c12345/$everything?_debug=true')
                .set(healthServiceHeader);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse4Resource);
        });

        test('Everything operation on client person: Get no data when access token matched & even consent provided', async () => {
            // We get no data here as access code for client person is not matched & further processing is not done.

            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    clientObservationResource, client1PersonResource, client1PatientResource, client1ObservationResource,
                    proaPatient1Resource, proaObservation1Resource, proaPatient2Resource, proaObservation2Resource,
                    hieTreatmentPatientResource, hieTreatmentObservationResource, clientConsentGivenResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Person/c12345/$everything?_debug=true')
                .set(healthServiceHeader);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse4Resource);
        });

        test('Everything operation on client patient: Get client patient data & not proa/hie patient, even consent provided', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    clientObservationResource, client1PersonResource, client1PatientResource, client1ObservationResource,
                    proaPatient1Resource, proaObservation1Resource, proaPatient2Resource, proaObservation2Resource,
                    hieTreatmentPatientResource, hieTreatmentObservationResource, clientConsentGivenResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Patient/bb7862e6-b7ac-470e-bde3-e85cee9d1ce6/$everything?_debug=true')
                .set(headers);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse5Resource);
        });

        test('Everything operation on client patient-1: Only data of client patient-1 must be returned, regardless of consent', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    clientObservationResource, client1PersonResource, client1PatientResource, client1ObservationResource,
                    proaPatient1Resource, proaObservation1Resource, proaPatient2Resource, proaObservation2Resource,
                    hieTreatmentPatientResource, hieTreatmentObservationResource, clientConsentGivenResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Patient/bb7762e6-b7ac-470e-bde3-e85cee9d1ce6/$everything?_debug=true')
                .set(client1Headers);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse6Resource);
        });

        test('Everything operation on proa patient-1: Get linked client person and proa data, when consent provided', async () => {
            // Here access token 'client' is provided & consent is provided. So even we are fetching proa patient, we get linked client person.
            // If consent is not provided here, then this client person would not come.
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    clientObservationResource, client1PersonResource, client1PatientResource, client1ObservationResource,
                    proaPatient1Resource, proaObservation1Resource, proaPatient2Resource, proaObservation2Resource,
                    hieTreatmentPatientResource, hieTreatmentObservationResource, clientConsentGivenResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Patient/bb7862e6-b7ac-470e-bde3-e85cee9d1ce7/$everything?_debug=true')
                .set(headers);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse7Resource);
        });

        test('Everything operation on proa patient-1: Get all linked data, with appropriate access token, consent provided', async () => {
            // Here client person is not received as it's access token is different.
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    clientObservationResource, client1PersonResource, client1PatientResource, client1ObservationResource,
                    proaPatient1Resource, proaObservation1Resource, proaPatient2Resource, proaObservation2Resource,
                    hieTreatmentPatientResource, hieTreatmentObservationResource, clientConsentGivenResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Patient/bb7862e6-b7ac-470e-bde3-e85cee9d1ce7/$everything?_debug=true')
                .set(healthServiceHeader);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse8Resource);
        });

        test('Everything operation on proa patient-2: Get linked client person and proa data, with different access token and consent provided', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    clientObservationResource, client1PersonResource, client1PatientResource, client1ObservationResource,
                    proaPatient1Resource, proaObservation1Resource, proaPatient2Resource, proaObservation2Resource,
                    hieTreatmentPatientResource, hieTreatmentObservationResource, clientConsentGivenResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Patient/bb7862e6-b7ac-470e-bde3-e85cee9d1ce8/$everything?_debug=true')
                .set(headers);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse7Resource1);
        });

        test('Everything operation on proa patient-2: Get all linked data, with appropriate access token, consent provided', async () => {
            // Here client person is not received as it's access token is different.
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    clientObservationResource, client1PersonResource, client1PatientResource, client1ObservationResource,
                    proaPatient1Resource, proaObservation1Resource, proaPatient2Resource, proaObservation2Resource,
                    hieTreatmentPatientResource, hieTreatmentObservationResource, clientConsentGivenResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Patient/bb7862e6-b7ac-470e-bde3-e85cee9d1ce8/$everything')
                .set(healthService1Header);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse9Resource);
        });

        test('Everything operation on hie/treatment patient: Get linked client person and hie data, with different access token, when consent provided', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    clientObservationResource, client1PersonResource, client1PatientResource, client1ObservationResource,
                    proaPatient1Resource, proaObservation1Resource, proaPatient2Resource, proaObservation2Resource,
                    hieTreatmentPatientResource, hieTreatmentObservationResource, clientConsentGivenResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Patient/d4c639de-f892-5b89-a63c-f64f0f2d69d1/$everything?_debug=true')
                .set(headers);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse10Resource);
        });

        test('Everything operation on hie/treatment patient: Get all linked data, with appropriate access token, even no consent provided', async () => {
            // Here client person is not received as it's access token is different.
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, masterPatientResource, clientPersonResource, clientPatientResource,
                    clientObservationResource, client1PersonResource, client1PatientResource, client1ObservationResource,
                    proaPatient1Resource, proaObservation1Resource, proaPatient2Resource, proaObservation2Resource,
                    hieTreatmentPatientResource, hieTreatmentObservationResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Patient/d4c639de-f892-5b89-a63c-f64f0f2d69d1/$everything?_debug=true')
                .set(healthService2Header);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse11Resource);
        });

        test('PROA data sharing flow: Person with 16 linked patients (15 health-service + 1 client with consent), should return 16 Patients after adding 5 unlinked PROA and 5 unlinked IAS patients', async () => {

            const originalConsentConnectionTypesList = process.env.CONSENT_CONNECTION_TYPES_LIST;
            process.env.CONSENT_CONNECTION_TYPES_LIST = 'proa,ias';
            const request = await createTestRequest((c) => c);

            // UUIDs for all resources in this test
            const PERSON_ID = '67d19544-8fc0-48b6-ac85-be2b93601d89';
            const PERSON_UUID = '5b2a5863-f72c-56dd-b69d-e6ab595d9208';
            const CLIENT_PATIENT_ID = '88f5637f-76a3-49ee-87d1-6c94992d98d3';
            const CONSENT_ID = '2c5fe296-8455-42ba-b480-0060b8822e2b';
            const HS_PATIENT_IDS = [
                '57d9ffb0-9e56-45ae-920d-3207ca68662f',
                '8bd79f0d-9424-4541-87c6-6a2aef8780c6',
                '551fbc8e-9b8b-46f6-9b72-317791cd8f13',
                '8be6cf0b-d80f-4794-a2ed-a5cb25426f1f',
                '69fb4066-0ad3-4886-b3ba-d9d425a14e56',
                'ce2c9180-7533-4b07-88f5-90453bfb5a12',
                'db5ae1ac-c551-47ac-9fb1-c00dccfc7fdb',
                '04ac4f1d-a52c-4f89-b039-111137a8cb36',
                'deaaf9d6-30a2-416c-9f5e-f8b7d00a1703',
                '520a7a62-cdf9-4965-be03-a8118243556c',
                'c9228c22-5251-46d2-85df-6e7202c8840c',
                '3641e21e-6d86-4b6f-97f3-030457d0403d',
                '8ab14d3b-fee4-46ab-95a3-5005b82cba25',
                '68449a3b-275d-4fe1-b8a4-6cc7bc70577c',
                'f7a4bd42-05cb-4dc4-b168-328dbfd73bc7'
            ];
            const UNLINKED_PROA_IDS = [
                'd6a2775d-51e7-41a7-9ed9-e32a2bdeaa95',
                'f8601543-bb78-4b2c-a79d-981f9657eba3',
                '8dfcd1a1-42e3-4ddc-96e7-ef079d8a9faa',
                'd82bf42b-faf3-4e5f-8374-f989bb5ada83',
                '0becb0e8-fbba-4a02-90d5-93e67a981946'
            ];
            const UNLINKED_IAS_IDS = [
                '5fc6dedc-1b45-4afc-8dce-2b26e66266a2',
                '79c4b3d7-3d65-43a8-8c74-9b128012045b',
                '121a3502-7adf-4253-a1bf-e8a7cd856670',
                '3e79cac4-0309-45e4-8d33-8d6382554222',
                '4e522cba-71ec-4f10-86c8-5e5cdf02ce26'
            ];

            const proaBulkPerson = {
                resourceType: 'Person',
                id: PERSON_ID,
                meta: {
                    source: 'client',
                    security: [
                        { system: 'https://www.icanbwell.com/access', code: 'client' },
                        { system: 'https://www.icanbwell.com/owner', code: 'client' }
                    ]
                },
                name: [{ use: 'official', family: 'Irving', given: ['Lloyd'] }],
                gender: 'male',
                birthDate: '1996-03-03',
                link: [
                    // 15 health-service patients
                    ...HS_PATIENT_IDS.map((id) => ({
                        target: { reference: `Patient/${id}`, type: 'Patient' },
                        assurance: 'level4'
                    })),
                    // 1 client patient with consent
                    {
                        target: { reference: `Patient/${CLIENT_PATIENT_ID}`, type: 'Patient' },
                        assurance: 'level4'
                    }
                ]
            };

            // 15 health-service patients linked to the Person (connectionType=proa)
            const healthServicePatients = HS_PATIENT_IDS.map((id, i) => ({
                resourceType: 'Patient',
                id,
                meta: {
                    source: 'health-service',
                    security: [
                        { system: 'https://www.icanbwell.com/access', code: 'health-service' },
                        { system: 'https://www.icanbwell.com/owner', code: 'health-service' },
                        { system: 'https://www.icanbwell.com/connectionType', code: 'proa' }
                    ]
                },
                name: [{ use: 'usual', family: `HS-PATIENT-${i + 1}`, given: ['HEALTH'] }],
                gender: 'female',
                birthDate: '1990-01-01'
            }));

            // 1 client patient with data-sharing consent linked to the Person
            const proaBulkClientPatient = {
                resourceType: 'Patient',
                id: CLIENT_PATIENT_ID,
                meta: {
                    source: 'client',
                    security: [
                        { system: 'https://www.icanbwell.com/access', code: 'client' },
                        { system: 'https://www.icanbwell.com/owner', code: 'client' }
                    ]
                },
                name: [{ use: 'usual', family: 'BULK-CLIENT', given: ['PATIENT'] }],
                gender: 'female',
                birthDate: '1990-01-01'
            };

            // Data-sharing consent for the client patient
            const proaBulkConsent = {
                resourceType: 'Consent',
                id: CONSENT_ID,
                meta: {
                    source: 'client',
                    security: [
                        { system: 'https://www.icanbwell.com/access', code: 'client' },
                        { system: 'https://www.icanbwell.com/owner', code: 'client' }
                    ]
                },
                status: 'active',
                category: [
                    {
                        coding: [
                            { system: 'http://www.icanbwell.com/consent-category', code: 'dataSharing' }
                        ]
                    }
                ],
                scope: {
                    coding: [
                        {
                            system: 'http://terminology.hl7.org/CodeSystem/consentscope',
                            code: 'patient-privacy'
                        }
                    ]
                },
                patient: { reference: `Patient/${CLIENT_PATIENT_ID}` },
                dateTime: '2022-09-08T14:05:07.350Z',
                provision: {
                    type: 'permit',
                    actor: [
                        {
                            role: {
                                coding: [
                                    {
                                        system: 'http://terminology.hl7.org/CodeSystem/v3-ParticipationType',
                                        code: 'CST'
                                    }
                                ]
                            },
                            reference: { reference: `Patient/${CLIENT_PATIENT_ID}` }
                        },
                        {
                            role: {
                                coding: [
                                    {
                                        system: 'http://terminology.hl7.org/3.1.0/CodeSystem-v3-RoleCode.html',
                                        code: 'AUT'
                                    }
                                ]
                            },
                            reference: { reference: `Patient/person.${PERSON_UUID}` }
                        }
                    ]
                }
            };

            // --- Phase 1: Insert Person + 16 linked patients + consent ---
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([proaBulkPerson, ...healthServicePatients, proaBulkClientPatient, proaBulkConsent])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get(`/4_0_0/Person/${PERSON_ID}/$everything?_type=Patient`)
                .set({ ...headers, prefer: 'global_id=false' });

            // Expect exactly 16 patients: 15 health-service + 1 client
            const phase1PatientCount = resp.body.entry?.filter(
                (e) => e.resource?.resourceType === 'Patient'
            ).length;
            expect(phase1PatientCount).toEqual(16);

            // --- Phase 2: Add 5 unlinked PROA patients + 5 unlinked IAS patients ---

            // 5 PROA patients NOT linked via Person.link
            const unlinkedProaPatients = UNLINKED_PROA_IDS.map((id, i) => ({
                resourceType: 'Patient',
                id,
                meta: {
                    source: 'health-service',
                    security: [
                        { system: 'https://www.icanbwell.com/access', code: 'health-service' },
                        { system: 'https://www.icanbwell.com/owner', code: 'health-service' },
                        { system: 'https://www.icanbwell.com/connectionType', code: 'proa' }
                    ]
                },
                name: [{ use: 'usual', family: `UNLINKED-PROA-${i + 1}`, given: ['PATIENT'] }],
                gender: 'female',
                birthDate: '1990-01-01'
            }));

            // 5 IAS patients NOT linked via Person.link
            const unlinkedIasPatients = UNLINKED_IAS_IDS.map((id, i) => ({
                resourceType: 'Patient',
                id,
                meta: {
                    source: 'health-service',
                    security: [
                        { system: 'https://www.icanbwell.com/access', code: 'health-service' },
                        { system: 'https://www.icanbwell.com/owner', code: 'health-service' },
                        { system: 'https://www.icanbwell.com/connectionType', code: 'ias' }
                    ]
                },
                name: [{ use: 'usual', family: `UNLINKED-IAS-${i + 1}`, given: ['PATIENT'] }],
                gender: 'female',
                birthDate: '1990-01-01'
            }));

            resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([...unlinkedProaPatients, ...unlinkedIasPatients])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get(`/4_0_0/Person/${PERSON_ID}/$everything?_type=Patient`)
                .set({ ...headers, prefer: 'global_id=false' });

            console.log(resp.body.entry);
            // Expect 16 total patient excluding 5 unlinked IAS and PROA
            const phase2PatientCount = resp.body.entry?.filter(
                (e) => e.resource?.resourceType === 'Patient'
            ).length;
            expect(phase2PatientCount).toEqual(16);

            process.env.CONSENT_CONNECTION_TYPES_LIST = originalConsentConnectionTypesList;
        });
    });
});
