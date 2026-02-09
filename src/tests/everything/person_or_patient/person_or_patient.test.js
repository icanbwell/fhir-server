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
const expectedPersonTopLevelResources = require('./fixtures/expected/expected_Person_personTopLevel.json');
const expectedPerson1Resources = require('./fixtures/expected/expected_Person_person1_no_graph.json');
const expectedMultiplePersonResources = require('./fixtures/expected/expected_multiple_person_response.json');
const expectedNoIdResponse = require('./fixtures/expected/expected_no_id_response.json');
const expectedPersonResourcesType = require('./fixtures/expected/expected_Person_type.json');

const expectedPatientEverythingPatientPersonResource = require('./fixtures/expected/expected_Patient_everything_Patient_Person_resource.json');
const expectedPatientEverythingPatientScope = require('./fixtures/expected/expected_Patient_everything_Patient_scope.json');
const expectedPatientEverythingPatientWithSubscription = require('./fixtures/expected/expected_Patient_everything_Patient_with_Subscription.json');
const expectedPatientResources = require('./fixtures/expected/expected_Patient_no_graph.json');
const expectedPatientResourcesGlobalId = require('./fixtures/expected/expected_Patient_no_graph_global_id.json');
const expectedPatientResourcesWithUuidOnly = require('./fixtures/expected/expected_Patient_no_graph_uuid_only.json');
const expectedPatientResourceWithIncludeAllUuidOnly = require('./fixtures/expected/expected_Patient_no_graph_all_uuid_only.json');
const expectedPatientResourcesWithNonClinicalAndAllUuidOnly = require('./fixtures/expected/expected_Patient_no_graph_include_non_clinical_all_uuid_only.json');
const expectedPatientResourcesTypeNoGraph = require('./fixtures/expected/expected_Patient_type_no_graph.json');
const expectedPatientIncludeHiddenResourcesNoGraph = require('./fixtures/expected/expected_Patient_no_graph_include_hidden.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest, getTestContainer, getHeadersWithCustomPayload } = require('../../common');
const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');
const { FhirResourceSerializer } = require('../../../fhir/fhirResourceSerializer');
const deepcopy = require('deepcopy');

describe('Person and Patient $everything Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Person and Patient $everything Tests', () => {
        test('Person and Patient $everything works', async () => {
            const serializerSpy = jest.spyOn(FhirResourceSerializer, 'serialize');
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
                .get('/4_0_0/Patient/patient1/$everything?_debug=true&_includePatientLinkedOnly=true')
                .set(getHeaders());
            expect(resp).toHaveMongoQuery(expectedPatientResourcesGlobalId);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPatientResourcesGlobalId);

            // with _includePatientLinkedUuidOnly only
            resp = await request
                .get('/4_0_0/Patient/patient1/$everything?_debug=true&_includePatientLinkedUuidOnly=true')
                .set(getHeaders());
            expect(resp).toHaveMongoQuery(expectedPatientResourcesWithUuidOnly);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPatientResourcesWithUuidOnly);

            // with _includeUuidOnly and _includePatientLinkedOnly as true
            resp = await request
                .get('/4_0_0/Patient/patient1/$everything?_debug=true&_includeUuidOnly=true&_includePatientLinkedOnly=true')
                .set(getHeaders());
            expect(resp).toHaveMongoQuery(expectedPatientResourceWithIncludeAllUuidOnly);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPatientResourceWithIncludeAllUuidOnly);

            // should not use projection when _includePatientLinkedOnly is false
            resp = await request
                .get('/4_0_0/Patient/patient1/$everything?_debug=true&_includeUuidOnly=true&_includePatientLinkedOnly=false')
                .set(getHeaders());
            expect(resp).toHaveMongoQuery(expectedPatientResourcesWithNonClinicalAndAllUuidOnly);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPatientResourcesWithNonClinicalAndAllUuidOnly);

            // get patient everything with global_id as false
            resp = await request
                .get('/4_0_0/Patient/patient1/$everything?_debug=true&_includePatientLinkedOnly=true')
                .set({
                    ...getHeaders(),
                    prefer: 'global_id=false'
                });
            expect(resp).toHaveMongoQuery(expectedPatientResources);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPatientResources);

            // Second get person everything from topLevel
            resp = await request
                .get('/4_0_0/Person/personTopLevel/$everything')
                .set({
                    ...getHeaders(),
                    prefer: 'global_id=false'
                });
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonTopLevelResources);

            // Third get person everything from person1
            resp = await request
                .get('/4_0_0/Person/person1/$everything')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPerson1Resources);

            resp = await request
                .get('/4_0_0/Person/person1,personTopLevel/$everything?_debug=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedMultiplePersonResources);

            resp = await request
                .get('/4_0_0/Person/$everything?id=person1,personTopLevel&_debug=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedMultiplePersonResources);

            resp = await request
                .get('/4_0_0/Person/$everything?_id=person1,personTopLevel&_debug=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedMultiplePersonResources);

            resp = await request
                .get('/4_0_0/Person/$everything')
                .set(getHeaders());
            // set diagnostic from response as empty string
            resp.body.entry[0].resource.issue[0].diagnostics = '';
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedNoIdResponse);

            resp = await request
                .get('/4_0_0/Patient/$everything')
                .set(getHeaders());
            // set diagnostic from response as empty string
            resp.body.entry[0].resource.issue[0].diagnostics = '';
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedNoIdResponse);

            expect(serializerSpy).toHaveBeenCalled();
        });

        test('Person and Patient $everything works with _type', async () => {
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

            // ACT & ASSERT
            // Check get patient everything with specified resources
            resp = await request
                .get('/4_0_0/Patient/patient1/$everything?_type=Account,Observation,Person&_includePatientLinkedOnly=true&_debug=true')
                .set({
                    ...getHeaders(),
                    prefer: 'global_id=false'
                });
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPatientResourcesTypeNoGraph);

            // Check get person everything with specified resources
            resp = await request
                .get('/4_0_0/Person/person1/$everything?_type=Account,Person')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonResourcesType);
        });

        test('Nesting of $everything', async () => {
            const serializerSpy = jest.spyOn(FhirResourceSerializer, 'serialize');
            // create a new container
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(parentPerson1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(parentPersonResource)
                .set(getHeaders());
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

        test('Person and Patient $everything works with _includeHidden tag', async () => {
            const serializerSpy = jest.spyOn(FhirResourceSerializer, 'serialize');
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
                .get('/4_0_0/Patient/patient1/$everything?_debug=true&_includeHidden=1&_includePatientLinkedOnly=true')
                .set({
                    ...getHeaders(),
                    prefer: 'global_id=false'
                });
            expect(resp).toHaveMongoQuery(expectedPatientIncludeHiddenResourcesNoGraph);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPatientIncludeHiddenResourcesNoGraph);

            expect(serializerSpy).toHaveBeenCalled();
        });

        test('Patient $everything with different resource and scope access', async () => {
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

            resp = await request.get('/4_0_0/Patient/patient1/$everything').set({
                ...getHeaders('user/Patient.* user/Person.* access/*.*'),
                prefer: 'global_id=false'
            }).expect(200);
            expect(resp).toHaveResponse(expectedPatientEverythingPatientPersonResource);

            // patient everything with patient scope
            let jwtPayload = {
                username: 'test',
                client_id: 'client',
                clientFhirPersonId: '7b99904f-2f85-51a3-9398-e2eed6854639',
                clientFhirPatientId: '24a5930e-11b4-5525-b482-669174917044',
                bwellFhirPersonId: 'master-person',
                bwellFhirPatientId: 'master-patient',
                token_use: 'access',
                scope: 'patient/Patient.* patient/Account.* patient/Observation.write user/Person.* access/access.*'
            };
            let patientHeader = getHeadersWithCustomPayload(jwtPayload);

            resp = await request.get('/4_0_0/Patient/patient1/$everything').set({
                ...patientHeader,
                prefer: 'global_id=false'
            }).expect(200);
            expect(resp).toHaveResponse(expectedPatientEverythingPatientScope);

            // patient everything with patient scope
            jwtPayload = {
                username: 'test',
                client_id: 'client',
                clientFhirPersonId: '7b99904f-2f85-51a3-9398-e2eed6854639',
                clientFhirPatientId: '24a5930e-11b4-5525-b482-669174917044',
                bwellFhirPersonId: 'master-person',
                bwellFhirPatientId: 'master-patient',
                token_use: 'access',
                scope: 'patient/Patient.* patient/Subscription.* patient/SubscriptionTopic.* patient/SubscriptionStatus.write user/Person.* user/Account.* access/*.*'
            };

            patientHeader = getHeadersWithCustomPayload(jwtPayload);

            resp = await request.get('/4_0_0/Patient/patient1/$everything').set({
                ...patientHeader,
                prefer: 'global_id=false'
            }).expect(200);
            expect(resp).toHaveResponse(expectedPatientEverythingPatientWithSubscription);
        });

        test('Patient $everything works with redis', async () => {
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

            expect(resp).toHaveMergeResponse({ created: true });
            let jwtPayload = {
                scope: 'patient/*.* user/*.* access/*.*',
                username: 'test',
                client_id: 'client',
                clientFhirPersonId: '7b99904f-2f85-51a3-9398-e2eed6854639',
                clientFhirPatientId: '24a5930e-11b4-5525-b482-669174917044',
                bwellFhirPersonId: 'master-person',
                bwellFhirPatientId: 'master-patient',
                token_use: 'access'
            };
            let patientHeader = getHeadersWithCustomPayload(jwtPayload);
            const container = getTestContainer();
            const streams = container.redisClient.streams;
            const redisReadSpy = jest.spyOn(container.redisStreamManager, 'readBundleEntriesFromStream');
            // Test without redis enabled
            resp = await request
                .get('/4_0_0/Patient/patient1/$everything')
                .set(getHeaders());

            expect(Array.from(streams.keys())).toHaveLength(0);
            expect(resp).toHaveResourceCount(10);
            expect(resp.headers).toHaveProperty('x-cache', 'Miss');

            // Test with redis enabled
            process.env.ENABLE_REDIS = '1';
            process.env.ENABLE_REDIS_CACHE_WRITE_FOR_EVERYTHING_OPERATION = '1';
            resp = await request
                .get('/4_0_0/Patient/patient1/$everything')
                .set(patientHeader);

            expect(resp).toHaveResourceCount(8);
            let cacheKey = 'Patient:24a5930e-11b4-5525-b482-669174917044:Everything:Scopes:41b78b54-0a8e-5477-af30-d99864d04833';
            expect(streams.keys()).toContain(cacheKey);
            expect(streams.get(cacheKey)).toHaveLength(8);

            // Test cache Miss when redis read disabled
            resp = await request
                .get('/4_0_0/Patient/patient1/$everything')
                .set(patientHeader);

            expect(redisReadSpy).not.toHaveBeenCalled();
            expect(resp.headers).toHaveProperty('x-cache', 'Miss');

            process.env.ENABLE_REDIS_CACHE_READ_FOR_EVERYTHING_OPERATION = '1';
            resp = await request
                .get('/4_0_0/Patient/patient1/$everything')
                .set(patientHeader);
            expect(redisReadSpy).toHaveBeenCalled();
            expect(resp.headers).toHaveProperty('x-cache', 'Hit');
            expect(resp).toHaveResourceCount(8);
            streams.clear();
            redisReadSpy.mockClear();

            // Test no cache in case of service account
            resp = await request
                .get('/4_0_0/Patient/patient1/$everything')
                .set(getHeaders());

            expect(Array.from(streams.keys())).toHaveLength(0);

            // Test no cache in case of params
            resp = await request
                .get('/4_0_0/Patient/patient1/$everything?_debug=True')
                .set(patientHeader);

            expect(Array.from(streams.keys())).toHaveLength(0);


            // Test no cache in case of csv/excel content type
            let headers = getHeaders();
            headers['Accept'] = 'text/csv';
            resp = await request
                .get('/4_0_0/Patient/patient1/$everything')
                .set(headers);

            expect(Array.from(streams.keys())).toHaveLength(0);

            // Testing Multiple patients linked with same sourceId
            let patient4Resource = deepcopy(patient1Resource);
            patient4Resource.meta.security = [
                {
                    system: "https://www.icanbwell.com/access",
                    code: "healthsystem1"
                },
                {
                    system: "https://www.icanbwell.com/owner",
                    code: "healthsystem2"
                }
            ];
            let person4Resource = deepcopy(person1Resource);
            person4Resource.link = [
                {
                    target: {
                        reference: "Patient/patient1|healthsystem1",
                        type: "Patient"
                    },
                    assurance: "level4"
                },
                {
                    target: {
                        reference: "Patient/patient1|healthsystem2",
                        type: "Patient"
                    },
                    assurance: "level4"
                }
            ]
            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patient4Resource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person4Resource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: false });

            resp = await request
                .get('/4_0_0/Patient/patient1/$everything')
                .set(patientHeader);

            expect(resp).toHaveResourceCount(9);
            expect(Array.from(streams.keys())).toHaveLength(0);

            // Testing redis
            resp = await request
                .get('/4_0_0/Patient/patient1/$everything')
                .set(patientHeader);

            expect(redisReadSpy).not.toHaveBeenCalled();
            expect(resp).toHaveResourceCount(9);
            expect(resp.headers).toHaveProperty('x-cache', 'Miss');

            // Test no cached response in case of cache-control:no-cache
            redisReadSpy.mockClear();
            headers = getHeaders();
            headers['Cache-Control'] = 'no-cache';
            resp = await request
                .get('/4_0_0/Patient/patient1/$everything')
                .set(headers);

            expect(redisReadSpy).not.toHaveBeenCalled();
            expect(resp.headers).toHaveProperty('x-cache', 'Miss')
            streams.clear();
            redisReadSpy.mockClear();

            process.env.ENABLE_REDIS = '0';
            process.env.ENABLE_REDIS_CACHE_WRITE_FOR_EVERYTHING_OPERATION = '0';
        });
    });
});
