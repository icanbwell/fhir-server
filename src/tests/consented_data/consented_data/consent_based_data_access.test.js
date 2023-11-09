const deepcopy = require('deepcopy');

// test file
const masterPersonResource = require('./fixtures/person/master_person.json');
const clientPersonResource = require('./fixtures/person/client_person.json');
const masterPatientResource = require('./fixtures/patient/master_patient.json');
const clientPatientResource = require('./fixtures/patient/client_patient.json');
const proaPatientResource = require('./fixtures/patient/proa_patient.json');
const clientObservationResource = require('./fixtures/observation/client_observation.json');
const proaObservationResource = require('./fixtures/observation/proa_observation.json');
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

// expected
const expectedClintObservation = require('./fixtures/expected/client_observation.json');
const expectedProaObservation = require('./fixtures/expected/proa_observation.json');
const expectedProaObservation2 = require('./fixtures/expected/proa_observation2.json');
const expectedProaObservation2ProxyCopy = require('./fixtures/expected/proa_observation2_proxy_copy.json');
const expectedClient1Observation = require('./fixtures/expected/client_1_observation.json');
const expectedXyzObservationJson = require('./fixtures/expected/xyz_observation.json');
const expectedHighMarkObservationJson = require('./fixtures/expected/highmark_observation.json');

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
const clientAndClient1AccessHeaders = getHeaders('user/*.read access/client-1.* access/client.*');

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

        test('Consent has provided, it should return all the data linked including multiple client-person if client has access to it and mater person proxy reference passed', async () => {
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

            let expectedClintObservationCopy = deepcopy(expectedClintObservation);
            expectedClintObservationCopy['subject']['reference'] = 'Patient/person.08f1b73a-e27c-456d-8a61-277f164a9a57';

            let expectedClient1ObservationCopy = deepcopy(expectedClient1Observation);
            let expectedXyzObservationCopy = deepcopy(expectedXyzObservationJson);
            expectedClient1ObservationCopy['subject']['reference'] = 'Patient/person.08f1b73a-e27c-456d-8a61-277f164a9a57';
            expectedXyzObservationCopy['subject']['reference'] = 'Patient/person.08f1b73a-e27c-456d-8a61-277f164a9a57';

            // Get Observation for a specific person
            resp = await request
                .get('/4_0_0/Observation?patient=Patient/person.08f1b73a-e27c-456d-8a61-277f164a9a57&_sort=_uuid')
                .set(clientAndClient1AccessHeaders);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse([expectedClient1ObservationCopy, expectedProaObservation2ProxyCopy, expectedXyzObservationCopy, expectedClintObservationCopy]);

            // Should return only client-1 resources
            resp = await request
                .get('/4_0_0/Observation?patient=Patient/person.08f1b73a-e27c-456d-8a61-277f164a9a57&_sort=_uuid')
                .set(client1Headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse([expectedClient1ObservationCopy, expectedXyzObservationCopy]);

        });

        test('Should not be able to access resource if proxy-person references is not present', async () => {
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
                    xyzObservationResource,
                    highmarkPatientResource,
                    highmarkObservationResource
                ])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // Get Observation for xyz and client-1 patient
            resp = await request
                .get('/4_0_0/Observation?patient=Patient/69e5e0ca-27dd-4560-9963-590e6ca4abd3,Patient/0afee0eb-4984-46ea-8052-63fad42e4817|xyz,Patient/44001f52-99f5-4246-9c9a-d7ed1c1c8b39&_sort=_uuid')
                .set(client1Headers);
            // noinspection JSUnresolvedFunction
            // console.log(JSON.stringify(JSON.parse(resp.text), null, '\t'));
            expect(resp).toHaveResponse([expectedClient1Observation, expectedXyzObservationJson, expectedHighMarkObservationJson]);
        });
    });
});
