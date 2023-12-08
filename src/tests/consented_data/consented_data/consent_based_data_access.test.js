const deepcopy = require('deepcopy');

// test file
const masterPersonResource = require('./fixtures/person/master_person.json');
const clientPersonResource = require('./fixtures/person/client_person.json');
const masterPatientResource = require('./fixtures/patient/master_patient.json');
const clientPatientResource = require('./fixtures/patient/client_patient.json');
const proaPatientResource = require('./fixtures/patient/proa_patient.json');
const clientObservationResource = require('./fixtures/observation/client_observation.json');
const proaObservationResource = require('./fixtures/observation/proa_observation.json');
const nonProaObservationResource = require('./fixtures/observation/non_proa_observation.json');
const consentGivenResource = require('./fixtures/consent/consent_given.json');
const consentDeniedResource = require('./fixtures/consent/consent_denied.json');
const masterPersonResource2 = require('./fixtures/person/master_person2.json');
const clientPersonResource2 = require('./fixtures/person/client_person2.json');
const masterPatientResource2 = require('./fixtures/patient/master_patient2.json');
const clientPatientResource2 = require('./fixtures/patient/client_patient2.json');
const proaPatientResource2 = require('./fixtures/patient/proa_patient2.json');
const proaObservationResource2 = require('./fixtures/observation/proa_observation2.json');
const consentGivenResource2 = require('./fixtures/consent/consent_given2.json');

// client-1 data
const client1PersonResource = require('./fixtures/person/client_1_person.json');
const client1ConsentResource = require('./fixtures/consent/consent_given_client_1.json');
const xyzObservationResource = require('./fixtures/observation/xyz_observation.json');
const client1ObservationResource = require('./fixtures/observation/client_1_observation.json');
const highmarkPatientResource = require('./fixtures/patient/highmark_patient.json');
const highmarkObservationResource = require('./fixtures/observation/highmark_observation.json');
const client1PatientResource = require('./fixtures/patient/client_1_patient.json');
const xyzPatientResource = require('./fixtures/patient/xyz_patient.json');

// expected
const expectedClintObservation = require('./fixtures/expected/client_observation.json');
const expectedProaObservation = require('./fixtures/expected/proa_observation.json');
const expectedProaObservation2 = require('./fixtures/expected/proa_observation2.json');
const expectedClient1Observation = require('./fixtures/expected/client_1_observation.json');
const expectedXyzObservationJson = require('./fixtures/expected/xyz_observation.json');
const expectedHighMarkObservationJson = require('./fixtures/expected/highmark_observation.json');
const expectedPatientWithConsentForClient1Json = require('./fixtures/expected/all_patient_related_to_client_1_consented.json');
const expectedPatientWithoutConsentForClientJson = require('./fixtures/expected/patient_of_client_1_with_no_consent.json');
const expectedObservationAndConsentQueryWithoutProxyPatient = require('./fixtures/expected/observation_result_consent_query_without_proxy_patient.json');

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

describe('Consent Based Data Access Test', () => {
    const cursorSpy = jest.spyOn(DatabasePartitionedCursor.prototype, 'hint');

    beforeEach(async () => {
        cursorSpy.mockReturnThis();
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
                .send([masterPersonResource, clientPersonResource, masterPatientResource,
                    clientPatientResource, proaPatientResource, clientObservationResource, proaObservationResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            let expectedClintObservationCopy = deepcopy(expectedClintObservation);
            expectedClintObservationCopy['subject']['reference'] = 'Patient/person.08f1b73a-e27c-456d-8a61-277f164a9a57';

            // Get Observation for a specific person
            resp = await request
                .get('/4_0_0/Observation?patient=Patient/person.08f1b73a-e27c-456d-8a61-277f164a9a57')
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse([expectedClintObservationCopy]);
        });
        test('Consent has provided to Client', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, clientPersonResource, masterPatientResource,
                    clientPatientResource, proaPatientResource, clientObservationResource, proaObservationResource, consentGivenResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            let expectedClintObservationCopy = deepcopy(expectedClintObservation);
            expectedClintObservationCopy['subject']['reference'] = 'Patient/person.08f1b73a-e27c-456d-8a61-277f164a9a57';
            let expectedProaObservationCopy = deepcopy(expectedProaObservation);
            expectedProaObservationCopy['subject']['reference'] = 'Patient/person.08f1b73a-e27c-456d-8a61-277f164a9a57';

            // Get Observation for a specific person, client have access to read both proa and client resources
            resp = await request
                .get('/4_0_0/Observation?patient=Patient/person.08f1b73a-e27c-456d-8a61-277f164a9a57&_sort=_uuid')
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse([expectedProaObservationCopy, expectedClintObservationCopy]);
        });

        test('Consent has provided to Client but proa data doesnot have connection type', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, clientPersonResource, masterPatientResource,
                    clientPatientResource, proaPatientResource, clientObservationResource, nonProaObservationResource, consentGivenResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            let expectedClintObservationCopy = deepcopy(expectedClintObservation);
            expectedClintObservationCopy['subject']['reference'] = 'Patient/person.08f1b73a-e27c-456d-8a61-277f164a9a57';
            let expectedProaObservationCopy = deepcopy(expectedProaObservation);
            expectedProaObservationCopy['subject']['reference'] = 'Patient/person.08f1b73a-e27c-456d-8a61-277f164a9a57';

            // Get Observation for a specific person, client have access to read both proa and client resources
            resp = await request
                .get('/4_0_0/Observation?patient=Patient/person.08f1b73a-e27c-456d-8a61-277f164a9a57&_sort=_uuid')
                .set(headers);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse([expectedClintObservationCopy]);
            expect(resp.body.length).toEqual(1);
        });

        test('Consent has created but denied access to Client', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, clientPersonResource, masterPatientResource,
                    clientPatientResource, proaPatientResource, clientObservationResource, proaObservationResource, consentDeniedResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            let expectedClintObservationCopy = deepcopy(expectedClintObservation);
            expectedClintObservationCopy['subject']['reference'] = 'Patient/person.08f1b73a-e27c-456d-8a61-277f164a9a57';

            // Get Observation for a specific person
            resp = await request
                .get('/4_0_0/Observation?patient=Patient/person.08f1b73a-e27c-456d-8a61-277f164a9a57&_sort=_uuid')
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse([expectedClintObservationCopy]);
        });

        test('Check Consented data fetching using patient ID', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, clientPersonResource, masterPatientResource,
                    clientPatientResource, proaPatientResource, clientObservationResource, proaObservationResource, consentGivenResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // Get Observation for proa patient only
            resp = await request
                .get('/4_0_0/Observation?patient=Patient/fde7f82b-b1e4-4a25-9a58-83b6921414cc&_sort=_uuid')
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse([expectedProaObservation]);

            // Get Observation for both client and proa
            resp = await request
                .get('/4_0_0/Observation?patient=Patient/fde7f82b-b1e4-4a25-9a58-83b6921414cc,Patient/bb7862e6-b7ac-470e-bde3-e85cee9d1ce6&_sort=_uuid')
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse([expectedProaObservation, expectedClintObservation]);
        });

        test('Check Consented data fetching for two different patient and both have consented', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, clientPersonResource, masterPatientResource,
                    clientPatientResource, proaPatientResource, clientObservationResource, proaObservationResource,
                    consentGivenResource, masterPersonResource2, clientPersonResource2, masterPatientResource2,
                    clientPatientResource2, proaPatientResource2, proaObservationResource2, consentGivenResource2
                ])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // Get Observation for proa patient and proa patient2
            resp = await request
                .get('/4_0_0/Observation?patient=Patient/ede65c66-66ae-42ef-a19d-871065c2421d,Patient/fde7f82b-b1e4-4a25-9a58-83b6921414cc&_sort=_uuid')
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse([expectedProaObservation, expectedProaObservation2]);
        });

        test('Check Consented data fetching for two different patient but only has consented', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, clientPersonResource, masterPatientResource,
                    clientPatientResource, proaPatientResource, clientObservationResource, proaObservationResource,
                    consentDeniedResource, masterPersonResource2, clientPersonResource2, masterPatientResource2,
                    clientPatientResource2, proaPatientResource2, proaObservationResource2, consentGivenResource2
                ])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // Get Observation for proa patient and proa patient2
            resp = await request
                .get('/4_0_0/Observation?patient=Patient/ede65c66-66ae-42ef-a19d-871065c2421d,Patient/fde7f82b-b1e4-4a25-9a58-83b6921414cc&_sort=_uuid')
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse([expectedProaObservation2]);
        });

        test('Consent has provided, it should return all consented data when searching with proxy-patient with master person id', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Update proa resouce to use proxy patient as reference
            let proaObservationResourceCopy = deepcopy(proaObservationResource);

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, clientPersonResource, masterPatientResource,
                    client1PersonResource, client1ConsentResource, client1ObservationResource,
                    xyzPatientResource, xyzObservationResource,
                    clientPatientResource, proaPatientResource, clientObservationResource, proaObservationResourceCopy, consentGivenResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // Get Observation for a specific person
            resp = await request
                .get('/4_0_0/Observation?patient=Patient/person.08f1b73a-e27c-456d-8a61-277f164a9a57&_sort=_uuid&_rewritePatientReference=0')
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse([expectedProaObservation, expectedClintObservation]);

            // Should return only client-1 resources
            resp = await request
                .get('/4_0_0/Observation?patient=Patient/person.08f1b73a-e27c-456d-8a61-277f164a9a57&_sort=_uuid&_rewritePatientReference=0')
                .set(client1Headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse([expectedClient1Observation, expectedXyzObservationJson]);

        });

        test('Only one client Consent has provided, it should return only consented data when searching with proxy-patient with master person id', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Update proa resouce to use proxy patient as reference
            let proaObservationResourceCopy = deepcopy(proaObservationResource);

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, clientPersonResource, masterPatientResource,
                    client1PersonResource, client1ConsentResource, client1ObservationResource,
                    xyzPatientResource, xyzObservationResource,
                    clientPatientResource, proaPatientResource, clientObservationResource, proaObservationResourceCopy])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // Get Observation for a specific person
            resp = await request
                .get('/4_0_0/Observation?patient=Patient/person.08f1b73a-e27c-456d-8a61-277f164a9a57&_sort=_uuid&_rewritePatientReference=0')
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse([expectedClintObservation]);

            // Should return only client-1 resources
            resp = await request
                .get('/4_0_0/Observation?patient=Patient/person.08f1b73a-e27c-456d-8a61-277f164a9a57&_sort=_uuid&_rewritePatientReference=0')
                .set(client1Headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse([expectedClient1Observation, expectedXyzObservationJson]);

        });

        test('Should not be able to access resource if proxy-patient references is not present', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            const consentGivenResourceCopy = deepcopy(consentGivenResource);
            delete consentGivenResourceCopy.provision.actor[1];
            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, clientPersonResource, masterPatientResource,
                    clientPatientResource, proaPatientResource, clientObservationResource, proaObservationResource,
                    consentGivenResourceCopy, masterPersonResource2, clientPersonResource2, masterPatientResource2,
                    clientPatientResource2, proaPatientResource2, proaObservationResource2, consentGivenResource2
                ])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // Get Observation for proa patient and proa patient2
            resp = await request
                .get('/4_0_0/Observation?patient=Patient/ede65c66-66ae-42ef-a19d-871065c2421d,Patient/fde7f82b-b1e4-4a25-9a58-83b6921414cc&_sort=_uuid')
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse([expectedProaObservation2]);
        });

        test('Should be able to access observation of xyz and highmark if client-1 has consent', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            const consentGivenResourceCopy = deepcopy(consentGivenResource);
            delete consentGivenResourceCopy.provision.actor[1];
            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource,
                    client1PersonResource, client1ConsentResource, client1ObservationResource,
                    xyzPatientResource, xyzObservationResource, highmarkPatientResource, highmarkObservationResource
                ])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // Get Observation for xyz and client-1 patient
            resp = await request
                .get('/4_0_0/Observation?patient=Patient/69e5e0ca-27dd-4560-9963-590e6ca4abd3,Patient/0afee0eb-4984-46ea-8052-63fad42e4817|xyz,Patient/44001f52-99f5-4246-9c9a-d7ed1c1c8b39&_sort=_uuid')
                .set(client1Headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse([expectedClient1Observation, expectedXyzObservationJson, expectedHighMarkObservationJson]);
        });

        test('Should not be able to access patient of xyz and highmark if client-1 doesn\'t have consent', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            const consentGivenResourceCopy = deepcopy(consentGivenResource);
            delete consentGivenResourceCopy.provision.actor[1];
            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, client1PatientResource, xyzPatientResource, highmarkPatientResource,
                    client1PersonResource, client1ObservationResource,
                    xyzObservationResource,
                    highmarkObservationResource
                ])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Patient?_id=69e5e0ca-27dd-4560-9963-590e6ca4abd3,0afee0eb-4984-46ea-8052-63fad42e4817,44001f52-99f5-4246-9c9a-d7ed1c1c8b39&_sort=_uuid&_debug=1&_bundle=1')
                .set(client1Headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPatientWithoutConsentForClientJson);
        });

        test('Should be able to access patient of xyz and highmark if client-1 have consent', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            const consentGivenResourceCopy = deepcopy(consentGivenResource);
            delete consentGivenResourceCopy.provision.actor[1];
            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource,
                    client1PersonResource, client1ConsentResource, client1ObservationResource,
                    xyzObservationResource,
                    highmarkPatientResource,
                    highmarkObservationResource,
                    client1PatientResource, xyzPatientResource
                ])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Patient/?id=69e5e0ca-27dd-4560-9963-590e6ca4abd3,0afee0eb-4984-46ea-8052-63fad42e4817,44001f52-99f5-4246-9c9a-d7ed1c1c8b39&_sort=_uuid&_bundle=1&_debug=1')
                .set(client1Headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPatientWithConsentForClient1Json);
        });

        test('Should be able to access observation based on patient searched using proxy-person', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            const consentGivenResourceCopy = deepcopy(consentGivenResource);
            delete consentGivenResourceCopy.provision.actor[1];
            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource,
                    client1PersonResource, client1ConsentResource, client1ObservationResource,
                    xyzObservationResource,
                    highmarkPatientResource,
                    highmarkObservationResource,
                    client1PatientResource, xyzPatientResource
                ])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Patient/?id=person.bdc02b42-ad3a-4e8b-a607-6210316cf58e&_sort=_uuid&_rewritePatientReference=0')
                .set(client1Headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(3);
            const patientIds = JSON.parse(resp.text).map((r) => r.id);

            resp = await request
                 .get(`/4_0_0/Observation/?patient=${patientIds.map(id => `Patient/${id}`).join(',')}`)
                 .set(client1Headers);

            expect(resp).toHaveResponse([expectedClient1Observation, expectedXyzObservationJson, expectedHighMarkObservationJson]);
        });

        test('Consent has provided, search on basis of proxy-person, consent query should not contain proxy-patient', async () => {
            const request = await createTestRequest((c) => {
                return c;
            });

            // Update proa resouce to use proxy patient as reference
            let proaObservationResourceCopy = deepcopy(proaObservationResource);

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send([masterPersonResource, clientPersonResource, masterPatientResource,
                    client1PersonResource, client1ConsentResource, client1ObservationResource,
                    xyzObservationResource,
                    clientPatientResource, proaPatientResource, clientObservationResource, proaObservationResourceCopy, consentGivenResource])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // Get Observation for a specific person
            resp = await request
                .get('/4_0_0/Observation?patient=Patient/person.33226ded-51e8-590e-8342-1197955a2af7&_sort=_uuid&_rewritePatientReference=0&_debug=1&_bundle=1')
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationAndConsentQueryWithoutProxyPatient);
        });
    });
});
