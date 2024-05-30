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

// expected
const expectedSubscriptionResources = require('./fixtures/expected/expected_subscription.json');
const expectedSubscriptionResources2 = require('./fixtures/expected/expected_subscription2.json');
const expectedSubscriptionInvalidResources = require('./fixtures/expected/expected_subscription_invalid.json');

const deepcopy = require('deepcopy');
const fs = require('fs');
const path = require('path');

const subscriptionQuery = fs.readFileSync(path.resolve(__dirname, './fixtures/query.graphql'), 'utf8');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getGraphQLHeadersWithPerson,
    getHeadersWithCustomPayload
} = require('../../common');
const {describe, beforeEach, afterEach, test, expect} = require('@jest/globals');

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
        test('Read & Write Subscription with Patient Scope', async () => {
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

            let subscriptionResponse = await request
                .post('/4_0_0/Subscription/$merge')
                .send(subscription4Resource)
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(subscriptionResponse).toHaveMergeResponse({ created: true });

            const person_payload = {
                scope: 'patient/Subscription.*',
                username: 'patient-123@example.com',
                clientFhirPersonId: personResponse2.body.uuid,
                clientFhirPatientId: 'clientFhirPatient',
                bwellFhirPersonId: personResponse.body.uuid,
                bwellFhirPatientId: 'bwellFhirPatient',
                token_use: 'access'
            };

            const headers1 = getHeadersWithCustomPayload(person_payload);

            // Successful read Subscription request for Patient Scope
            let resp = await request
                .get('/4_0_0/Subscription/subscription4')
                .set(headers1)
                .expect(200)

            expect(resp).toHaveResponse(expectedSubscriptionResources2)

            let subscriptionResponseWithChange = deepcopy(subscription4Resource.entry[0].resource);

            subscriptionResponseWithChange.reason = 'Monitor new neonatal function';

            // Unsuccessful write Subscription request for Patient Scope
            resp = await request
                .put('/4_0_0/Subscription/subscription4')
                .set(headers1)
                .send(subscriptionResponseWithChange)
                .expect(403)

            expect(resp).toHaveResponse(
                {
                    resourceType: 'OperationOutcome',
                    issue: [
                        {
                            severity: 'error',
                            code: 'forbidden',
                            details: {
                                text: "The current patient scope and person id in the JWT token do not allow writing the Subscription resource."
                            },
                            diagnostics: "The current patient scope and person id in the JWT token do not allow writing the Subscription resource."
                        }
                    ]
                }
            );

            person_payload.clientFhirPersonId = personResponse.body.uuid;

            const headers2 = getHeadersWithCustomPayload(person_payload);

            resp = await request
                .get('/4_0_0/Subscription/subscription4')
                .set(headers2)
                .expect(404)

            expect(resp).toHaveResponse(
                {
                    resourceType: 'OperationOutcome',
                    issue: [{
                        severity: 'error', code: 'not-found', details: {
                            text: 'Resource not found: Subscription/subscription4'
                        }
                    }]
                }

            )
        });
    });
});
