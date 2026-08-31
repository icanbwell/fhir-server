const patientResource1 = require('./fixtures/patient1.json')
const patientResource2 = require('./fixtures/patient2.json')

const personResource1 = require('./fixtures/person1.json')
const personResource2 = require('./fixtures/person2.json')

const observationResource1 = require('./fixtures/observation1.json')

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getHeadersWithCustomPayload
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Remove with Proxy Patient', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Remove with Proxy Patient', () => {

        test('Remove Observation using Client person as proxy patient', async () => {
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

            await request
                .post('/4_0_0/Observation/')
                .set(headers1)
                .send(observationResource1)
                .expect(201);

            const observationResponse = await request
                .delete(`/4_0_0/Observation/${observationResource1.id}`)
                .set(headers1)
                .expect(204)

            expect(observationResponse).toHaveResponse({})
        });

        test('Remove Observation using BWell person as proxy patient', async () => {
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
                clientFhirPersonId: person1.body.uuid,
                clientFhirPatientId: 'clientFhirPatient',
                bwellFhirPersonId: person1.body.uuid,
                bwellFhirPatientId: 'bwellFhirPatient',
                token_use: 'access'
            };

            const headers1 = getHeadersWithCustomPayload(person_payload);

            observationResource1.subject.reference = `Patient/person.${person1.body.uuid}`;

            await request
                .post('/4_0_0/Observation/')
                .set(headers1)
                .send(observationResource1)
                .expect(201);

            const observationResponse = await request
                .delete(`/4_0_0/Observation/${observationResource1.id}`)
                .set(headers1)
                .expect(204)

            expect(observationResponse).toHaveResponse({})

        });

        test('Remove Observation using Client patient as proxy patient', async () => {

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
                .post('/4_0_0/Person/$merge')
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

            observationResource1.subject.reference = `Patient/${patient1.body.uuid}`;

            await request
                .post('/4_0_0/Observation/')
                .set(headers1)
                .send(observationResource1)
                .expect(201);

            const observationResponse = await request
                .delete(`/4_0_0/Observation/${observationResource1.id}`)
                .set(headers1)
                .expect(204)

            expect(observationResponse).toHaveResponse({})
        });

        test('Remove Observation using Bwell patient as proxy patient', async () => {

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
                .post('/4_0_0/Person/$merge')
                .set(getHeaders())
                .send(patientResource2)
                .expect(200);

            expect(patient2).toHaveMergeResponse({ created: true });

            const person_payload = {
                scope: 'patient/*.* user/*.* access/*.*',
                username: 'patient-123@example.com',
                clientFhirPersonId: person1.body.uuid,
                clientFhirPatientId: 'clientFhirPatient',
                bwellFhirPersonId: person1.body.uuid,
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

            const observationResponse = await request
                .delete(`/4_0_0/Observation/${observationResource1.id}`)
                .set(headers1)
                .expect(204)

            expect(observationResponse).toHaveResponse({})
        });
    });
});
