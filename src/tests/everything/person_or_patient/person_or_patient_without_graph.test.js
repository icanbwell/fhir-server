const { ConfigManager } = require('../../../utils/configManager');

// test file
const parentPersonResource = require('./fixtures/Person/parentPerson.json');
const parentPerson1Resource = require('./fixtures/Person/parentPerson1.json');
const topLevelPersonResource = require('./fixtures/Person/topLevelPerson.json');
const person1Resource = require('./fixtures/Person/person1.json');
const person2Resource = require('./fixtures/Person/person2.json');

const patient1Resource = require('./fixtures/Patient/patient1.json');
const patient2Resource = require('./fixtures/Patient/patient2.json');
const patient3Resource = require('./fixtures/Patient/patient3.json');

const accountResource = require('./fixtures/Account/account.json');
const unlinkedAccountResource = require('./fixtures/Account/unlinked_account.json');

const observation1Resource = require('./fixtures/Observation/observation1.json');
const observation2Resource = require('./fixtures/Observation/observation2.json');

const subscription1Resource = require('./fixtures/Subscription/subscription1.json');
const subscription2Resource = require('./fixtures/Subscription/subscription2.json');

const subscriptionStatus1Resource = require('./fixtures/SubscriptionStatus/subscriptionStatus1.json');
const subscriptionStatus2Resource = require('./fixtures/SubscriptionStatus/subscriptionStatus2.json');

const subscriptionTopic1Resource = require('./fixtures/SubscriptionTopic/subscriptionTopic1.json');
const subscriptionTopic2Resource = require('./fixtures/SubscriptionTopic/subscriptionTopic2.json');

// expected
const expectedPerson1Resources = require('./fixtures/expected/expected_Person_person1.json');
const expectedPersonResourcesType = require('./fixtures/expected/expected_Person_type.json');
const expectedPerson1ContainedResources = require('./fixtures/expected/expected_Person_person1_contained.json');

const expectedPatientResources = require('./fixtures/expected/expected_Patient.json');
const expectedPatientResourcesTypeNoGraph = require('./fixtures/expected/expected_Patient_type_no_graph.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');
const { FhirResourceSerializer } = require('../../../fhir/fhirResourceSerializer');

class MockConfigManagerRawEverythingWithSerializer extends ConfigManager {
    get getRawEverythingOpBundle() {
        return true;
    }

    get disableGraphInEverythingOp() {
        return true;
    }
}

describe('Person and Patient $everything Tests works for new everything flow', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('Person and Patient $everything works', async () => {
        const serializerSpy = jest.spyOn(FhirResourceSerializer, 'serialize');
        // create a new container
        const request = await createTestRequest((container) => {
            container.register('configManager', () => new MockConfigManagerRawEverythingWithSerializer());
            return container;
        })

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
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patient3Resource)
                .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(accountResource)
                .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(unlinkedAccountResource)
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
            .post('/4_0_0/Subscription/subscription1/$merge?validate=true')
            .send(subscription1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Subscription/subscription2/$merge?validate=true')
            .send(subscription2Resource)
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
            .post('/4_0_0/SubscriptionStatus/1/$merge?validate=true')
            .send(subscriptionStatus2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/SubscriptionTopic/1/$merge?validate=true')
            .send(subscriptionTopic1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/SubscriptionTopic/1/$merge?validate=true')
            .send(subscriptionTopic2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        // ACT & ASSERT
        // First get patient everything
        resp = await request
            .get('/4_0_0/Patient/patient1/$everything?_debug=true')
            .set(getHeaders());
        expect(resp).toHaveMongoQuery(expectedPatientResources);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedPatientResources);

        // Third get person everything from person1
        resp = await request.get('/4_0_0/Person/person1/$everything').set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedPerson1Resources);
        resp = await request.get('/4_0_0/Person/person1/$everything?contained=true').set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedPerson1ContainedResources);
        expect(serializerSpy).toHaveBeenCalled();
    });

    test('Person and Patient $everything works with _type', async () => {
        const serializerSpy = jest.spyOn(FhirResourceSerializer, 'serialize');
        // create a new container
        const request = await createTestRequest((container) => {
            container.register('configManager', () => new MockConfigManagerRawEverythingWithSerializer());
            return container;
        });
        // ARRANGE
        // add the resources to FHIR server
        let resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(topLevelPersonResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request.post('/4_0_0/Person/1/$merge?validate=true').send(person1Resource).set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request.post('/4_0_0/Person/1/$merge?validate=true').send(person2Resource).set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request.post('/4_0_0/Patient/1/$merge?validate=true').send(patient1Resource).set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request.post('/4_0_0/Patient/1/$merge?validate=true').send(patient2Resource).set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request.post('/4_0_0/Patient/1/$merge?validate=true').send(patient3Resource).set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request.post('/4_0_0/Patient/1/$merge?validate=true').send(accountResource).set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(unlinkedAccountResource)
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
        // Check get patient everything with specified resources and check contained is ignored with _type
        resp = await request
            .get('/4_0_0/Patient/patient1/$everything?_type=Account,Observation,Person&contained=true&_debug=true')
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedPatientResourcesTypeNoGraph);

        // Check get person everything with specified resources
        resp = await request.get('/4_0_0/Person/person1/$everything?_type=Account,Person').set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedPersonResourcesType);
        expect(serializerSpy).toHaveBeenCalled();
    });

    test('Nesting of $everything', async () => {
        const serializerSpy = jest.spyOn(FhirResourceSerializer, 'serialize');
        // create a new container
        const request = await createTestRequest((container) => {
            container.register('configManager', () => new MockConfigManagerRawEverythingWithSerializer());
            return container;
        });
        // ARRANGE
        // add the resources to FHIR server
        let resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(parentPerson1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request.post('/4_0_0/Person/1/$merge?validate=true').send(parentPersonResource).set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(topLevelPersonResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request.post('/4_0_0/Person/1/$merge?validate=true').send(person1Resource).set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request.post('/4_0_0/Person/1/$merge?validate=true').send(person2Resource).set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request.post('/4_0_0/Patient/1/$merge?validate=true').send(patient1Resource).set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request.post('/4_0_0/Patient/1/$merge?validate=true').send(patient2Resource).set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request.post('/4_0_0/Patient/1/$merge?validate=true').send(patient3Resource).set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request.post('/4_0_0/Patient/1/$merge?validate=true').send(accountResource).set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(unlinkedAccountResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(observation1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        // ACT & ASSERT
        // First get patient everything
        resp = await request.get('/4_0_0/Patient/patient1/$everything?_debug=true').set(getHeaders());
        // Check that only resources having patient link are fetched.
        expect(resp.body.total).toEqual(7);
        expect(serializerSpy).toHaveBeenCalled();
    });
});
