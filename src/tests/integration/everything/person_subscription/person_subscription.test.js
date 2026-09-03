// test file
const personSubscriptionPayload = require('./fixtures/person_subscription_payload.json');

// expected
const expectedPersonEverything = require('./fixtures/expected/expected_person_everything.json');
const expectedPersonEverythingAfterUnlink = require('./fixtures/expected/expected_person_everything_after_unlink.json');
const expectedPatientEverything = require('./fixtures/expected/expected_patient_everything.json');
const expectedPatientEverythingWithSubscriptionScope = require('./fixtures/expected/expected_patient_everything_with_subscription_scope.json');
const expectedProxyPatientEverything = require('./fixtures/expected/expected_proxy_patient_everything.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getHeadersWithAdmin,
    getHeadersWithCustomPayload,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const deepcopy = require('deepcopy');

const PERSON1_UUID = '7b99904f-2f85-51a3-9398-e2eed6854639';
const PATIENT_LINKED_UUID = '19e6be2d-4503-55cd-a1bb-ca1f01b9fb72';

async function createResources(request) {
    const resp = await request
        .post('/4_0_0/Person/1/$merge?validate=true')
        .send(personSubscriptionPayload)
        .set(getHeaders());
    // noinspection JSUnresolvedFunction
    expect(resp).toHaveMergeResponse(personSubscriptionPayload.map(() => ({ created: true })));
}

describe('Person $everything Subscription scoping Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Person $everything', () => {
        test('returns the whole Subscription family matched on client_person_id while the Patient link is intact', async () => {
            const request = await createTestRequest();
            await createResources(request);

            const resp = await request
                .get('/4_0_0/Person/person1/$everything?_debug=true')
                .set({ ...getHeadersWithAdmin(), prefer: 'global_id=false' })
                .expect(200);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMongoQuery(expectedPersonEverything);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonEverything);
        });

        test('returns the Subscription family after the Patient named by source_patient_id is unlinked', async () => {
            const request = await createTestRequest();
            await createResources(request);

            const person1Resource = personSubscriptionPayload.find(
                (r) => r.resourceType === 'Person'
            );
            const personWithoutLinkedPatient = deepcopy(person1Resource);
            personWithoutLinkedPatient.link = person1Resource.link.filter(
                (l) => l.target.reference !== 'Patient/patientLinked|client'
            );
            const putResp = await request
                .put('/4_0_0/Person/person1')
                .send(personWithoutLinkedPatient)
                .set(getHeaders());
            expect([200, 201]).toContain(putResp.status);

            const personResp = await request
                .get('/4_0_0/Person/person1')
                .set({ ...getHeaders(), prefer: 'global_id=false' })
                .expect(200);
            expect(personResp.body.link.map((l) => l.target.reference)).toStrictEqual([
                'Patient/patientOther|client'
            ]);

            const resp = await request
                .get('/4_0_0/Person/person1/$everything?_debug=true')
                .set({ ...getHeadersWithAdmin(), prefer: 'global_id=false' })
                .expect(200);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMongoQuery(expectedPersonEverythingAfterUnlink);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonEverythingAfterUnlink);
        });
    });

    describe('Patient $everything', () => {
        test('never returns the Subscription family for a linked patient', async () => {
            const request = await createTestRequest();
            await createResources(request);

            const resp = await request
                .get('/4_0_0/Patient/patientLinked/$everything?_debug=true')
                .set({ ...getHeadersWithAdmin(), prefer: 'global_id=false' })
                .expect(200);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMongoQuery(expectedPatientEverything);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPatientEverything);
        });

        test('never returns the Subscription family even for a token carrying Subscription scopes', async () => {
            const request = await createTestRequest();
            await createResources(request);

            const patientHeader = getHeadersWithCustomPayload({
                username: 'test',
                client_id: 'client',
                clientFhirPersonId: PERSON1_UUID,
                clientFhirPatientId: PATIENT_LINKED_UUID,
                bwellFhirPersonId: 'master-person',
                bwellFhirPatientId: 'master-patient',
                token_use: 'access',
                scope: 'patient/Patient.* patient/Observation.* patient/Person.read patient/Subscription.* patient/SubscriptionStatus.* patient/SubscriptionTopic.* access/*.* admin/*.read'
            });

            const resp = await request
                .get('/4_0_0/Patient/patientLinked/$everything?_debug=true')
                .set({ ...patientHeader, prefer: 'global_id=false' })
                .expect(200);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMongoQuery(expectedPatientEverythingWithSubscriptionScope);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPatientEverythingWithSubscriptionScope);
        });

        test('never returns the Subscription family via the proxy patient id form', async () => {
            const request = await createTestRequest();
            await createResources(request);

            const resp = await request
                .get(`/4_0_0/Patient/person.${PERSON1_UUID}/$everything?_debug=true`)
                .set({ ...getHeadersWithAdmin(), prefer: 'global_id=false' })
                .expect(200);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMongoQuery(expectedProxyPatientEverything);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedProxyPatientEverything);
        });
    });
});
