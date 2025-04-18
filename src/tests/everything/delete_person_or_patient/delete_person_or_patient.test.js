// test file
const topLevelPersonResource = require('./fixtures/Person/topLevelPerson.json');
const person1Resource = require('./fixtures/Person/person1.json');
const person2Resource = require('./fixtures/Person/person2.json');

const patient1Resource = require('./fixtures/Patient/patient1.json');
const patient2Resource = require('./fixtures/Patient/patient2.json');

const observation1Resource = require('./fixtures/Observation/observation1.json');
const observation2Resource = require('./fixtures/Observation/observation2.json');
const unlinkedObservationResource = require('./fixtures/Observation/unlinked_observation.json');

const subscription1Resource = require('./fixtures/Subscription/subscription1.json');
const subscriptionStatus1Resource = require('./fixtures/SubscriptionStatus/subscriptionStatus1.json');
const subscriptionTopic1Resource = require('./fixtures/SubscriptionTopic/subscriptionTopic1.json');

// expected
const expectedPatientDeletedResources = require('./fixtures/expected/expected_Patient_deleted.json');
const expectedPatientDeletedResourcesType = require('./fixtures/expected/expected_Patient_deleted_type.json');
const expectedPersonDeletedResourcesType = require('./fixtures/expected/expected_Person_deleted_type.json');
const expectedPatientEverythingAfterTypeDelete = require('./fixtures/expected/expected_Patient_everything_after_type_delete.json');
const expectedDeleteEverythingForbidden = require('./fixtures/expected/expected_deleted_everything_forbidden.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Delete Person and Patient $everything Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Delete Person and Patient $everything Tests', () => {
        test('Delete Person and Patient $everything works', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(topLevelPersonResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patient1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patient2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(unlinkedObservationResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Subscription/subscription1/$merge?validate=true')
                .send(subscription1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/SubscriptionStatus/1/$merge?validate=true')
                .send(subscriptionStatus1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/SubscriptionTopic/1/$merge?validate=true')
                .send(subscriptionTopic1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // ACT & ASSERT
            // First get patient everything
            resp = await request
                .delete('/4_0_0/Patient/patient1/$everything')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPatientDeletedResources);

            resp = await request
                .get('/4_0_0/Patient/patient1/$everything')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            // make sure the topLevel Person is not deleted
            resp = await request
                .get('/4_0_0/Person/personTopLevel')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(1);

            // make sure the unlinked observation is not deleted
            resp = await request
                .get('/4_0_0/Observation/unlinked-observation')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(1);
        });

        test('Delete Person and Patient $everything works with _type', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(topLevelPersonResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patient1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patient2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // ACT & ASSERT
            // Test delete person only
            resp = await request
                .delete('/4_0_0/Patient/patient1/$everything?_type=Person')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPatientDeletedResourcesType);

            // verify other data is still present for patient
            resp = await request
                .get('/4_0_0/Patient/patient1/$everything')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPatientEverythingAfterTypeDelete);

            // Test delete Patient and observation
            resp = await request
                .delete('/4_0_0/Person/person2/$everything?_type=Patient,Observation')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonDeletedResourcesType);
        });

        test('Delete $everything is not accessible with Patient Scope', async () => {
            const request = await createTestRequest();
            // ACT & ASSERT
            let resp = await request
                .delete('/4_0_0/Patient/patient1/$everything')
                .set(getHeaders('patient/*.* access/*.* user/*.*'));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedDeleteEverythingForbidden);

            resp = await request
                .delete('/4_0_0/Person/person1/$everything')
                .set(getHeaders('patient/*.* access/*.* user/*.*'));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedDeleteEverythingForbidden);

            resp = await request
                .delete('/4_0_0/Person/person2/$everything?_type=Patient,Observation')
                .set(getHeaders('patient/*.* access/*.* user/*.*'));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedDeleteEverythingForbidden);

            resp = await request
                .delete('/4_0_0/Slot/slot1/$everything')
                .set(getHeaders('patient/*.* access/*.* user/*.*'));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedDeleteEverythingForbidden);
        });
    });
});
