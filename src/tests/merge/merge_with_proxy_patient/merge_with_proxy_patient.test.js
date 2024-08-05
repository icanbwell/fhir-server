const groupResource1 = require('./fixtures/Group/group1.json')

const patientResource1 = require('./fixtures/Patient/patient1.json')
const patientResource2 = require('./fixtures/Patient/patient2.json')

const personResource1 = require('./fixtures/Person/person1.json')
const personResource2 = require('./fixtures/Person/person2.json')

const observationResource1 = require('./fixtures/Observation/observation1.json')

const expectedGroup1ResourceUsingClientPerson = require('./expected/expected_group1_using_client_person.json')
const expectedGroup1ResourceUsingClientPatient = require('./expected/expected_group1_using_client_patient.json')

const expectedObservation1ResourceUsingClientPatient = require('./expected/expected_observation1_using_client_patient.json')
const expectedObservation1ResourceUsingClientPerson = require('./expected/expected_observation1_using_client_person.json'
)
const expectedForbiddenObservationResponse = require('./expected/expected_forbidden_observation_response.json')
const expectedForbiddenGroupResponse = require('./expected/expected_forbidden_group_response.json')

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getHeadersWithCustomPayload
} = require('../../common');

const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Merge with Proxy Patient', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Test for resource Observation', () => {


        test('Read/Write Observation using Client person as proxy patient', async () => {

            const request = await createTestRequest();

            const person1 = await request
                .post('/4_0_0/Person/$merge')
                .set(getHeaders())
                .send(personResource1)
                .expect(200);

            expect(person1).toHaveMergeResponse({ created: true });

            const person2 = await request
                .post('/4_0_0/Person/$merge')
                .set(getHeaders())
                .send(personResource2)
                .expect(200);

            expect(person2).toHaveMergeResponse({ created: true });

            const person_payload = {
                scope: 'patient/*.* user/*.* access/*.*',
                username: 'patient-123@example.com',
                clientFhirPersonId: person2.body.uuid,
                clientFhirPatientId: 'clientFhirPatient',
                bwellFhirPersonId: person1.body.uuid,
                bwellFhirPatientId: 'bwellFhirPatient',
                token_use: 'access'
            };

            const headers1 = getHeadersWithCustomPayload(person_payload);

            observationResource1.subject.reference = `Patient/person.${person2.body.uuid}`;

            const observation1 = await request
                .post('/4_0_0/Observation/$merge')
                .set(headers1)
                .send(observationResource1)
                .expect(200);

            expect(observation1).toHaveMergeResponse({ created: true });

            const observationResponse = await request
                .get(`/4_0_0/Observation?patient=person.4f77a49a-d8a8-4153-a2e9-13d6d0b4b301`)
                .set(headers1)
                .expect(200)

            expect(observationResponse).toHaveResponse(expectedObservation1ResourceUsingClientPerson);
        });

        test('Read/Write Observation using BWell person as proxy patient', async () => {
            const request = await createTestRequest();

            const person1 = await request
                .post('/4_0_0/Person/$merge')
                .set(getHeaders())
                .send(personResource1)
                .expect(200);
            const patient1 = await request
                .post('/4_0_0/Patient/$merge')
                .set(getHeaders())
                .send(patientResource1)
                .expect(200);

            expect(patient1).toHaveMergeResponse({ created: true });

            expect(person1).toHaveMergeResponse({ created: true });

            const person2 = await request
                .post('/4_0_0/Person/$merge')
                .set(getHeaders())
                .send(personResource2)
                .expect(200);

            expect(person2).toHaveMergeResponse({ created: true });

            const person_payload = {
                scope: 'patient/*.* user/*.* access/*.*',
                username: 'patient-123@example.com',
                clientFhirPersonId: person2.body.uuid,
                clientFhirPatientId: 'clientFhirPatient',
                bwellFhirPersonId: person1.body.uuid,
                bwellFhirPatientId: 'bwellFhirPatient',
                token_use: 'access'
            };

            const headers1 = getHeadersWithCustomPayload(person_payload);

            observationResource1.subject.reference = `Patient/person.${person1.body.uuid}`;
            expectedForbiddenObservationResponse.id = observationResource1.id
            expectedForbiddenObservationResponse.uuid = observationResource1.id

            const observation1 = await request
                .post('/4_0_0/Observation/$merge')
                .set(headers1)
                .send(observationResource1)
                .expect(200);

            expect(observation1).toHaveResponse(expectedForbiddenObservationResponse);
        });

        test('Read/Write Observation using BWell patient as proxy patient', async () => {
            const request = await createTestRequest();

            const person1 = await request
                .post('/4_0_0/Person/$merge')
                .set(getHeaders())
                .send(personResource1)
                .expect(200);

            expect(person1).toHaveMergeResponse({ created: true });

            const person2 = await request
                .post('/4_0_0/Person/$merge')
                .set(getHeaders())
                .send(personResource2)
                .expect(200);

            expect(person2).toHaveMergeResponse({ created: true });

            const patient1 = await request
                .post('/4_0_0/Patient/$merge')
                .set(getHeaders())
                .send(patientResource1)
                .expect(200);

            expect(patient1).toHaveMergeResponse({ created: true });

            const person_payload = {
                scope: 'patient/*.* user/*.* access/*.*',
                username: 'patient-123@example.com',
                clientFhirPersonId: person2.body.uuid,
                clientFhirPatientId: 'clientFhirPatient',
                bwellFhirPersonId: person1.body.uuid,
                bwellFhirPatientId: 'bwellFhirPatient',
                token_use: 'access'
            };

            const headers1 = getHeadersWithCustomPayload(person_payload);

            observationResource1.subject.reference = `Patient/person.${patient1.body.uuid}`;
            expectedForbiddenObservationResponse.id = observationResource1.id
            expectedForbiddenObservationResponse.uuid = observationResource1.id

            const observation1 = await request
                .post('/4_0_0/Observation/$merge')
                .set(headers1)
                .send(observationResource1)
                .expect(200);

            expect(observation1).toHaveResponse(expectedForbiddenObservationResponse);
        });
        test('Read/Write Observation using Client patient as proxy patient', async () => {
            const request = await createTestRequest();

            const person1 = await request
                .post('/4_0_0/Person/$merge')
                .set(getHeaders())
                .send(personResource1)
                .expect(200);

            expect(person1).toHaveMergeResponse({ created: true });

            const person2 = await request
                .post('/4_0_0/Person/$merge')
                .set(getHeaders())
                .send(personResource2)
                .expect(200);

            expect(person2).toHaveMergeResponse({ created: true });

            const patient2 = await request
                .post('/4_0_0/Patient/$merge')
                .set(getHeaders())
                .send(patientResource2)
                .expect(200);

            expect(patient2).toHaveMergeResponse({ created: true });

            const person_payload = {
                scope: 'patient/*.* user/*.* access/*.*',
                username: 'patient-123@example.com',
                clientFhirPersonId: person2.body.uuid,
                clientFhirPatientId: 'clientFhirPatient',
                bwellFhirPersonId: person1.body.uuid,
                bwellFhirPatientId: 'bwellFhirPatient',
                token_use: 'access'
            };

            const headers1 = getHeadersWithCustomPayload(person_payload);

            observationResource1.subject.reference = `Patient/${patient2.body.uuid}`;

            const observation1 = await request
                .post('/4_0_0/Observation/$merge')
                .set(headers1)
                .send(observationResource1)
                .expect(200);

            expect(observation1).toHaveMergeResponse({ created: true });

            const observationResponse = await request
                .get(`/4_0_0/Observation?patient=${patient2.body.uuid}`)
                .set(headers1)
                .expect(200)

            expect(observationResponse).toHaveResponse(expectedObservation1ResourceUsingClientPatient);
        });
    });

    describe('Test for resource Group', () => {

        test('Read/Write Group using Client person as proxy patient', async () => {
            const request = await createTestRequest();

            const person1 = await request
                .post('/4_0_0/Group/$merge')
                .set(getHeaders())
                .send(personResource1)
                .expect(200);

            expect(person1).toHaveMergeResponse({ created: true });

            const person2 = await request
                .post('/4_0_0/Person/$merge')
                .set(getHeaders())
                .send(personResource2)
                .expect(200);

            expect(person2).toHaveMergeResponse({ created: true });

            const person_payload = {
                scope: 'patient/*.* user/*.* access/*.*',
                username: 'patient-123@example.com',
                clientFhirPersonId: person2.body.uuid,
                clientFhirPatientId: 'clientFhirPatient',
                bwellFhirPersonId: person1.body.uuid,
                bwellFhirPatientId: 'bwellFhirPatient',
                token_use: 'access'
            };

            const headers1 = getHeadersWithCustomPayload(person_payload);

            groupResource1.member[0].entity.reference = `Patient/person.${person2.body.uuid}`;

            const group1 = await request
                .post('/4_0_0/Group/$merge')
                .set(headers1)
                .send(groupResource1)
                .expect(200);

            expect(group1).toHaveMergeResponse({ created: true });

            const groupResource = await request
                .get(`/4_0_0/Group?patient=person.${person2.body.uuid}`)
                .set(headers1)
                .expect(200)

            expect(groupResource).toHaveResponse(expectedGroup1ResourceUsingClientPerson);
        });

        test('Read/Write Group using BWell person as proxy patient', async () => {
            const request = await createTestRequest();

            const person1 = await request
                .post('/4_0_0/Person/$merge')
                .set(getHeaders())
                .send(personResource1)
                .expect(200);

            expect(person1).toHaveMergeResponse({ created: true });

            const person2 = await request
                .post('/4_0_0/Person/$merge')
                .set(getHeaders())
                .send(personResource2)
                .expect(200);

            expect(person2).toHaveMergeResponse({ created: true });

            const person_payload = {
                scope: 'patient/*.* user/*.* access/*.*',
                username: 'patient-123@example.com',
                clientFhirPersonId: person2.body.uuid,
                clientFhirPatientId: 'clientFhirPatient',
                bwellFhirPersonId: person1.body.uuid,
                bwellFhirPatientId: 'bwellFhirPatient',
                token_use: 'access'
            };

            const headers1 = getHeadersWithCustomPayload(person_payload);

            groupResource1.member[0].entity.reference = `Patient/person.${person1.body.uuid}`;

            const group1 = await request
                .post('/4_0_0/Group/$merge')
                .set(headers1)
                .send(groupResource1)
                .expect(200);

            expectedForbiddenGroupResponse.id = group1.body.id
            expectedForbiddenGroupResponse.uuid = group1.body.uuid

            expect(group1).toHaveResponse(expectedForbiddenGroupResponse);
        });

        test('Read/Write Group using Bwell patient as proxy patient', async () => {
            const request = await createTestRequest();

            const person1 = await request
                .post('/4_0_0/Person/$merge')
                .set(getHeaders())
                .send(personResource1)
                .expect(200);

            expect(person1).toHaveMergeResponse({ created: true });

            const person2 = await request
                .post('/4_0_0/Person/$merge')
                .set(getHeaders())
                .send(personResource2)
                .expect(200);

            expect(person2).toHaveMergeResponse({ created: true });

            const patient1 = await request
                .post('/4_0_0/Patient/$merge')
                .set(getHeaders())
                .send(patientResource1)
                .expect(200);

            expect(patient1).toHaveMergeResponse({ created: true });

            const person_payload = {
                scope: 'patient/*.* user/*.* access/*.*',
                username: 'patient-123@example.com',
                clientFhirPersonId: person2.body.uuid,
                clientFhirPatientId: 'clientFhirPatient',
                bwellFhirPersonId: person1.body.uuid,
                bwellFhirPatientId: 'bwellFhirPatient',
                token_use: 'access'
            };

            const headers1 = getHeadersWithCustomPayload(person_payload);

            groupResource1.member[0].entity.reference = `Patient/${patient1.body.uuid}`;

            const group1 = await request
                .post('/4_0_0/Group/$merge')
                .set(headers1)
                .send(groupResource1)
                .expect(200);

            expectedForbiddenGroupResponse.id = group1.body.id
            expectedForbiddenGroupResponse.uuid = group1.body.uuid

            expect(group1).toHaveMergeResponse(expectedForbiddenGroupResponse);

        });

        test('Read/Write Group using Client patient as proxy patient', async () => {
            const request = await createTestRequest();

            const person1 = await request
                .post('/4_0_0/Person/$merge')
                .set(getHeaders())
                .send(personResource1)
                .expect(200);

            expect(person1).toHaveMergeResponse({ created: true });

            const person2 = await request
                .post('/4_0_0/Person/$merge')
                .set(getHeaders())
                .send(personResource2)
                .expect(200);

            expect(person2).toHaveMergeResponse({ created: true });

            const patient2 = await request
                .post('/4_0_0/Patient/$merge')
                .set(getHeaders())
                .send(patientResource2)
                .expect(200);

            expect(patient2).toHaveMergeResponse({ created: true });

            const person_payload = {
                scope: 'patient/*.* user/*.* access/*.*',
                username: 'patient-123@example.com',
                clientFhirPersonId: person2.body.uuid,
                clientFhirPatientId: 'clientFhirPatient',
                bwellFhirPersonId: person1.body.uuid,
                bwellFhirPatientId: 'bwellFhirPatient',
                token_use: 'access'
            };

            const headers1 = getHeadersWithCustomPayload(person_payload);

            groupResource1.member[0].entity.reference = `Patient/${patient2.body.uuid}`;

            const group1 = await request
                .post('/4_0_0/Group/$merge')
                .set(headers1)
                .send(groupResource1)
                .expect(200);

            expect(group1).toHaveMergeResponse({ created: true });

            const groupResponse = await request
                .get(`/4_0_0/Group?patient=${patient2.body.uuid}`)
                .set(headers1)
                .expect(200)

            expect(groupResponse).toHaveResponse(expectedGroup1ResourceUsingClientPatient);
        });
    });
});
