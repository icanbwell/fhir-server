// test file
const subscription1Resource = require('./fixtures/Subscription/subscription1.json');
const subscription2Resource = require('./fixtures/Subscription/subscription2.json');
const subscription4Resource = require('./fixtures/Subscription/subscription4.json');
const subscriptionStatus1Resource = require('./fixtures/SubscriptionStatus/subscriptionStatus1.json');
const subscriptionStatus2Resource = require('./fixtures/SubscriptionStatus/subscriptionStatus2.json');
const subscriptionStatus3Resource = require('./fixtures/SubscriptionStatus/subscriptionStatus3.json');
const subscriptionTopic1Resource = require('./fixtures/SubscriptionTopic/subscriptionTopic1.json');
const subscriptionTopic2Resource = require('./fixtures/SubscriptionTopic/subscriptionTopic2.json');
const subscriptionTopic3Resource = require('./fixtures/SubscriptionTopic/subscriptionTopic3.json');
const patientBundleResource = require('./fixtures/Patient/patient1.json');
const personBundleResource = require('./fixtures/Person/person1.json');
const personBundle2Resource = require('./fixtures/Person/person2.json');
const personBundle3Resource = require('./fixtures/Person/person3.json');

const patient2Resource = require('./fixtures/Patient/patient_with_source_id.json');
const subscription5Resource = require('./fixtures/Subscription/subscription5.json');
const subscriptionStatus5Resource = require('./fixtures/SubscriptionStatus/subscriptionStatus5.json');
const subscriptionTopic5Resource = require('./fixtures/SubscriptionTopic/subscriptionTopic5.json');

// expected
const expectedSubscriptionResources = require('./fixtures/expected/expected_subscription.json');
const expectedSubscriptionResources2 = require('./fixtures/expected/expected_subscription2.json');
const expectedSubscriptionListResponse = require('./fixtures/expected/expected_subscriptions_list.json');
const expectedSubscriptionInvalidResources = require('./fixtures/expected/expected_subscription_invalid.json');
const expectedUpdateSubscriptionResponse = require('./fixtures/expected/expected_update_subscription.json');
const expectedCreateSubscriptionResponse = require('./fixtures/expected/expected_create_subscription.json');
const expectedsubscriptionNotFoundResponse = require('./fixtures/expected/expected_subscription_not_found.json');
const expectedSubscriptionWithPatientUuidResources = require('./fixtures/expected/expected_subscription_with_patient_uuid.json');

const deepcopy = require('deepcopy');
const fs = require('fs');
const path = require('path');

const subscriptionQuery = fs.readFileSync(path.resolve(__dirname, './fixtures/query.graphql'), 'utf8');
const subscription2Query = fs.readFileSync(path.resolve(__dirname, './fixtures/query2.graphql'), 'utf8');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getGraphQLHeadersWithPerson,
    getHeadersWithCustomPayload
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('GraphQL Subscription Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('GraphQL Subscription subscription Tests', () => {
        test('GraphQL subscription works', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Subscription/subscription1/$merge?validate=true')
                .send(subscription1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // resp = await request
            //     .get('/4_0_0/Subscription/subscription1')
            //     .set(getHeaders());

            resp = await request
                .post('/4_0_0/Subscription/subscription2/$merge?validate=true')
                .send(subscription2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/SubscriptionStatus/subscriptionStatus1/$merge?validate=true')
                .send(subscriptionStatus1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/SubscriptionStatus/subscriptionStatus2/$merge?validate=true')
                .send(subscriptionStatus2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/SubscriptionStatus/subscriptionStatus3/$merge?validate=true')
                .send(subscriptionStatus3Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/SubscriptionTopic/subscriptionTopic1/$merge?validate=true')
                .send(subscriptionTopic1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/SubscriptionTopic/subscriptionTopic2/$merge?validate=true')
                .send(subscriptionTopic2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/SubscriptionTopic/subscriptionTopic3/$merge?validate=true')
                .send(subscriptionTopic3Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patientBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(personBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(personBundle2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});


            const graphqlQueryText = subscriptionQuery.replace(/\\n/g, '');
            // ACT & ASSERT
            resp = await request
                // .get('/subscription/?query=' + graphqlQueryText)
                // .set(getHeaders())
                .post('/$graphql')
                .send({
                    operationName: null,
                    variables: {
                        FHIR_DEFAULT_COUNT: 10
                    },
                    query: graphqlQueryText
                })
                // .set(getGraphQLHeaders());
                .set(getGraphQLHeadersWithPerson('79e59046-ffc7-4c41-9819-c8ef83275454'));

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveGraphQLResponse(expectedSubscriptionResources, 'subscription');
        });
        test('GraphQL subscription requires patient access', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Subscription/subscription1/$merge?validate=true')
                .send(subscription1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // resp = await request
            //     .get('/4_0_0/Subscription/subscription1')
            //     .set(getHeaders());

            resp = await request
                .post('/4_0_0/Subscription/subscription2/$merge?validate=true')
                .send(subscription2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/SubscriptionStatus/subscriptionStatus1/$merge?validate=true')
                .send(subscriptionStatus1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/SubscriptionStatus/subscriptionStatus2/$merge?validate=true')
                .send(subscriptionStatus2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/SubscriptionStatus/subscriptionStatus3/$merge?validate=true')
                .send(subscriptionStatus3Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patientBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(personBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(personBundle2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});


            const graphqlQueryText = subscriptionQuery.replace(/\\n/g, '');
            // ACT & ASSERT
            resp = await request
                // .get('/subscription/?query=' + graphqlQueryText)
                // .set(getHeaders())
                .post('/$graphql')
                .send({
                    operationName: null,
                    variables: {
                        FHIR_DEFAULT_COUNT: 10
                    },
                    query: graphqlQueryText
                })
                // .set(getGraphQLHeaders());
                .set(getGraphQLHeadersWithPerson('xyz'));

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveGraphQLResponse(expectedSubscriptionInvalidResources, 'subscription');
        });

        test('Using patient/user JWT Create/Update/Get/List/Delete Subscriptions', async () => {
            const request = await createTestRequest();

            // ARRANGE
            // add the resources to FHIR server
            let personResponse = await request
                .post('/4_0_0/Person/$merge')
                .send(personBundleResource)
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(personResponse).toHaveMergeResponse({ created: true });

            let personResponse2 = await request
                .post('/4_0_0/Person/$merge')
                .send(personBundle2Resource)
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(personResponse2).toHaveMergeResponse({ created: true });

            const person_payload = {
                scope: 'patient/*.* user/*.* access/*.*',
                username: 'patient-123@example.com',
                clientFhirPersonId: personResponse2.body.uuid,
                clientFhirPatientId: 'clientFhirPatient',
                bwellFhirPersonId: personResponse.body.uuid,
                bwellFhirPatientId: 'bwellFhirPatient',
                token_use: 'access'
            };

            const headers1 = getHeadersWithCustomPayload(person_payload);

            // Create Subscriptions using patient/user JWT
            let resp = await request
                .post('/4_0_0/Subscription/')
                .send(subscription4Resource.entry[0].resource)
                .set(headers1)
                .expect(403)

            // Create Subscriptions via $merge with full access
            await request
                .post('/4_0_0/Subscription/$merge')
                .send(subscription4Resource)
                .set(getHeaders())
                .expect(200)

            // Get Subscriptions
            let subscriptionResponse = await request
                .get('/4_0_0/Subscription/?id=subscription4&_debug=1&_bundle=1')
                .set(headers1)
                .expect(200)

            expect(subscriptionResponse).toHaveResponse(expectedSubscriptionResources2)

            await request
                .post('/4_0_0/Subscription/$merge')
                .send(subscription2Resource)
                .set(getHeaders())
                .expect(200)

            // Get Subscriptions List
            let subscriptionListResponse = await request
                .get('/4_0_0/Subscription?_bundle=1&_debug=1')
                .set(headers1)
                .expect(200)

            expect(subscriptionListResponse).toHaveResponse(expectedSubscriptionListResponse)

            // Update Subscriptions
            let subscriptionResponseWithChange = deepcopy(subscription4Resource.entry[0].resource);
            subscriptionResponseWithChange.reason = 'Monitor new neonatal function';

            resp = await request
                .put('/4_0_0/Subscription/subscription4?_debug=1')
                .set(headers1)
                .send(subscriptionResponseWithChange)
                .expect(403)

            expect(resp).toHaveResponse(expectedUpdateSubscriptionResponse);

            // Create Subscriptions via $merge
            resp = await request
                .post('/4_0_0/Subscription/$merge?_debug=1')
                .send(subscription2Resource)
                .set(headers1)
                .expect(200)

            expect(resp).toHaveResponse(expectedCreateSubscriptionResponse);

            // Delete Subscriptions
            await request
                .delete('/4_0_0/Subscription/subscription4')
                .set(headers1)
                .expect(204)

            subscriptionListResponse = await request
                .get('/4_0_0/Subscription?_bundle=1')
                .set(headers1)
                .expect(200)

            expect(subscriptionListResponse.body.entry).toHaveLength(2)
        });

        test('Read & Write Subscription of another User', async () => {
            const request = await createTestRequest();

            // ARRANGE
            // add the resources to FHIR server
            let personResponse = await request
                .post('/4_0_0/Person/$merge')
                .send(personBundleResource)
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(personResponse).toHaveMergeResponse({ created: true });

            let personResponse2 = await request
                .post('/4_0_0/Person/$merge')
                .send(personBundle2Resource)
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(personResponse2).toHaveMergeResponse({ created: true });

            let personResponse3 = await request
                .post('/4_0_0/Person/$merge')
                .send(personBundle3Resource)
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(personResponse3).toHaveMergeResponse({ created: true });

            let subscriptionResponse = await request
                .post('/4_0_0/Subscription/$merge')
                .send(subscription4Resource)
                .set(getHeaders());

            // noinspection JSUnresolvedFunctiFon
            expect(subscriptionResponse).toHaveMergeResponse({ created: true });

            const person_payload = {
                scope: 'patient/Subscription.*',
                username: 'patient-123@example.com',
                clientFhirPersonId: personResponse3.body.uuid,
                clientFhirPatientId: 'clientFhirPatient',
                bwellFhirPersonId: personResponse.body.uuid,
                bwellFhirPatientId: 'bwellFhirPatient',
                token_use: 'access'
            };

            const headers = getHeadersWithCustomPayload(person_payload)
            let resp = await request
                .get('/4_0_0/Subscription/subscription4')
                .set(headers)
                .expect(404)

            expect(resp).toHaveResponse(expectedsubscriptionNotFoundResponse)

            // Update Subscriptions
            let subscriptionResponseWithChange = deepcopy(subscription4Resource.entry[0].resource);
            subscriptionResponseWithChange.reason = 'Monitor new neonatal function';

            resp = await request
                .put('/4_0_0/Subscription/subscription4')
                .send(subscriptionResponseWithChange)
                .set(headers)
                .expect(403)

            expect(resp).toHaveResponse(expectedUpdateSubscriptionResponse)
        });

        test('GraphQL subscription should return source-patient-id as uuid', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Subscription/subscription1/$merge?validate=true')
                .send(subscription5Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/SubscriptionStatus/subscriptionStatus1/$merge?validate=true')
                .send(subscriptionStatus5Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/SubscriptionTopic/subscriptionTopic1/$merge?validate=true')
                .send(subscriptionTopic5Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patient2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(personBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });


            const graphqlQueryText = subscription2Query.replace(/\\n/g, '');
            const headers = getGraphQLHeadersWithPerson('79e59046-ffc7-4c41-9819-c8ef83275454')
            headers.Prefer = 'global_id=true';
            // // // ACT & ASSERT
            resp = await request
                // .get('/subscription/?query=' + graphqlQueryText)
                // .set(getHeaders())
                .post('/$graphql')
                .send({
                    operationName: null,
                    variables: {
                        FHIR_DEFAULT_COUNT: 10
                    },
                    query: graphqlQueryText
                })
                // .set(getGraphQLHeaders());
                .set(headers);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveGraphQLResponse(expectedSubscriptionWithPatientUuidResources, 'subscription');
        });
    });
});
