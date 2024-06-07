// fixtures
const patient = require('./fixtures/patient.json');
const person = require('./fixtures/person.json');

const patientResource2 = require('./fixtures/patient2.json')
const patientResource3 = require('./fixtures/patient3.json')

const personResource2 = require('./fixtures/person2.json')
const personResource3 = require('./fixtures/person3.json')

const observationResource1 = require('./fixtures/observation1.json')

const expectedObservationResponseWithClientPerson = require('./expected/expected_observation_response_using_client_person.json')
const expectedObservationResponseWithBWellPerson = require('./expected/expected_observation_response_using_bwell_person.json')
const expectedObservationResponseWithBWellPatient = require('./expected/expected_observation_response_using_bwell_patient.json')
const expectedObservationResponseWithClientPatient = require('./expected/expected_observation_response_with_client_patient.json')

// expected
const expectedPatient = require('./expected/expected_patient.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getHeadersWithCustomPayload
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const deepcopy = require('deepcopy');

describe('Remove with Proxy Patient', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Patient put_response Tests', () => {
        test('put_response doesnt expands proxy patient, instead create new resource', async () => {
            const request = await createTestRequest();
            // Case when meta.source doesn't exist
            let resp = await request.post('/4_0_0/Patient/$merge').send(patient).set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request.post('/4_0_0/Person/$merge').send(person).set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            const patient2 = deepcopy(patient);
            delete patient2.id;

            // ARRANGE
            // add the resources to FHIR server
            resp = await request
                .put('/4_0_0/Patient/person.4f28941f-24af-4e81-89b7-d0bdd627626d')
                .send(patient2)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPatient);
            // should not expand proxy-patient, instead create a resource with that id
            expect(resp.status).toBe(201);
        });
        test('Put Observation using Client person as proxy patient', async () => {
            const request = await createTestRequest();

            const person2 = await request
                .post('/4_0_0/Person/$merge')
                .set(getHeaders())
                .send(personResource2)
                .expect(200);

            expect(person2).toHaveMergeResponse({ created: true });

            const person3 = await request
                .post('/4_0_0/Person/$merge')
                .set(getHeaders())
                .send(personResource3)
                .expect(200);

            expect(person3).toHaveMergeResponse({ created: true });

            const person_payload = {
                scope: 'patient/*.* user/*.* access/*.*',
                username: 'patient-123@example.com',
                clientFhirPersonId: person3.body.uuid,
                clientFhirPatientId: 'clientFhirPatient',
                bwellFhirPersonId: person2.body.uuid,
                bwellFhirPatientId: 'bwellFhirPatient',
                token_use: 'access'
            };

            const headers1 = getHeadersWithCustomPayload(person_payload);

            observationResource1.subject.reference = `Patient/person.${person3.body.uuid}`;

            await request
                .post('/4_0_0/Observation/')
                .set(headers1)
                .send(observationResource1)
                .expect(201);

            let observationResourceCopy1 = deepcopy(observationResource1)

            observationResourceCopy1.status = "cancelled"

            const observationResponse = await request
                .put(`/4_0_0/Observation/${observationResource1.id}`)
                .set(headers1)
                .send(observationResourceCopy1)
                .expect(201)

            expectedObservationResponseWithClientPerson[0].id = observationResponse.body.id
            expectedObservationResponseWithClientPerson[0].identifier[1].value = observationResponse.body.identifier[1].value
            expectedObservationResponseWithClientPerson[0].identifier[2].value = observationResponse.body.identifier[2].value

            expect(observationResponse).toHaveResponse(expectedObservationResponseWithClientPerson)

        });

        test('Put Observation using BWell person as proxy patient', async () => {
            const request = await createTestRequest();

            const person2 = await request
                .post('/4_0_0/Person/$merge')
                .set(getHeaders())
                .send(personResource2)
                .expect(200);

            expect(person2).toHaveMergeResponse({ created: true });

            const person3 = await request
                .post('/4_0_0/Person/$merge')
                .set(getHeaders())
                .send(personResource3)
                .expect(200);

            expect(person3).toHaveMergeResponse({ created: true });

            const person_payload = {
                scope: 'patient/*.* user/*.* access/*.*',
                username: 'patient-123@example.com',
                clientFhirPersonId: person3.body.uuid,
                clientFhirPatientId: 'clientFhirPatient',
                bwellFhirPersonId: person2.body.uuid,
                bwellFhirPatientId: 'bwellFhirPatient',
                token_use: 'access'
            };

            const headers1 = getHeadersWithCustomPayload(person_payload);

            observationResource1.subject.reference = `Patient/person.${person2.body.uuid}`;

            await request
                .post('/4_0_0/Observation/')
                .set(headers1)
                .send(observationResource1)
                .expect(201);

            let observationResourceCopy1 = deepcopy(observationResource1)

            observationResourceCopy1.status = "cancelled"

            const observationResponse = await request
                .put(`/4_0_0/Observation/${observationResource1.id}`)
                .set(headers1)
                .send(observationResourceCopy1)
                .expect(201)

            expectedObservationResponseWithBWellPerson[0].id = observationResponse.body.id
            expectedObservationResponseWithBWellPerson[0].identifier[1].value = observationResponse.body.identifier[1].value
            expectedObservationResponseWithBWellPerson[0].identifier[2].value = observationResponse.body.identifier[2].value

            expect(observationResponse).toHaveResponse(expectedObservationResponseWithBWellPerson)

        });

        test('Put Observation using Client patient as proxy patient', async () => {

            const request = await createTestRequest();

            const person2 = await request
                .post('/4_0_0/Person/$merge')
                .set(getHeaders())
                .send(personResource2)
                .expect(200);

            expect(person2).toHaveMergeResponse({ created: true });

            const person3 = await request
                .post('/4_0_0/Person/$merge')
                .set(getHeaders())
                .send(personResource3)
                .expect(200);

            expect(person3).toHaveMergeResponse({ created: true });

            const patient3 = await request
                .post('/4_0_0/Patient/$merge')
                .set(getHeaders())
                .send(patientResource3)
                .expect(200);

            expect(patient3).toHaveMergeResponse({ created: true });

            const person_payload = {
                scope: 'patient/*.* user/*.* access/*.*',
                username: 'patient-123@example.com',
                clientFhirPersonId: person3.body.uuid,
                clientFhirPatientId: 'clientFhirPatient',
                bwellFhirPersonId: person2.body.uuid,
                bwellFhirPatientId: 'bwellFhirPatient',
                token_use: 'access'
            };

            const headers1 = getHeadersWithCustomPayload(person_payload);

            observationResource1.subject.reference = `Patient/${patient3.body.uuid}`;

            await request
                .post('/4_0_0/Observation/')
                .set(headers1)
                .send(observationResource1)
                .expect(201);

            let observationResourceCopy1 = deepcopy(observationResource1)

            observationResourceCopy1.status = "cancelled"

            const observationResponse = await request
                .put(`/4_0_0/Observation/${observationResource1.id}`)
                .set(headers1)
                .send(observationResourceCopy1)
                .expect(201)

            expectedObservationResponseWithClientPatient[0].id = observationResponse.body.id
            expectedObservationResponseWithClientPatient[0].identifier[1].value = observationResponse.body.identifier[1].value
            expectedObservationResponseWithClientPatient[0].identifier[2].value = observationResponse.body.identifier[2].value

            expect(observationResponse).toHaveResponse(expectedObservationResponseWithClientPatient)
        });

        test('Put Observation using Bwell patient as proxy patient', async () => {

            const request = await createTestRequest();

            const person2 = await request
                .post('/4_0_0/Person/$merge')
                .set(getHeaders())
                .send(personResource2)
                .expect(200);

            expect(person2).toHaveMergeResponse({ created: true });

            const person3 = await request
                .post('/4_0_0/Person/$merge')
                .set(getHeaders())
                .send(personResource3)
                .expect(200);

            expect(person3).toHaveMergeResponse({ created: true });

            const patient2 = await request
                .post('/4_0_0/Patient/$merge')
                .set(getHeaders())
                .send(patientResource2)
                .expect(200);

            expect(patient2).toHaveMergeResponse({ created: true });

            const person_payload = {
                scope: 'patient/*.* user/*.* access/*.*',
                username: 'patient-123@example.com',
                clientFhirPersonId: person3.body.uuid,
                clientFhirPatientId: 'clientFhirPatient',
                bwellFhirPersonId: person2.body.uuid,
                bwellFhirPatientId: 'bwellFhirPatient',
                token_use: 'access'
            };

            const headers1 = getHeadersWithCustomPayload(person_payload);

            observationResource1.subject.reference = `Patient/${patient2.body.uuid}`;

            await request
                .post('/4_0_0/Observation/')
                .set(headers1)
                .send(observationResource1)
                .expect(201);

            let observationResourceCopy1 = deepcopy(observationResource1)

            observationResourceCopy1.status = "cancelled"

            const observationResponse = await request
                .put(`/4_0_0/Observation/${observationResource1.id}`)
                .set(headers1)
                .send(observationResourceCopy1)
                .expect(201)

            expectedObservationResponseWithBWellPatient[0].id = observationResponse.body.id
            expectedObservationResponseWithBWellPatient[0].identifier[1].value = observationResponse.body.identifier[1].value
            expectedObservationResponseWithBWellPatient[0].identifier[2].value = observationResponse.body.identifier[2].value

            expect(observationResponse).toHaveResponse(expectedObservationResponseWithBWellPatient)
        });
    });
});
