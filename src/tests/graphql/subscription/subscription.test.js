// test file
const subscription1Resource = require('./fixtures/Subscription/subscription1.json');
const subscriptionStatus1Resource = require('./fixtures/SubscriptionStatus/subscriptionStatus1.json');
const patientBundleResource = require('./fixtures/Patient/patient1.json');
const personBundleResource = require('./fixtures/Person/person1.json');

// expected
const expectedSubscriptionResources = require('./fixtures/expected/expected_subscription.json');

const fs = require('fs');
const path = require('path');

const subscriptionQuery = fs.readFileSync(path.resolve(__dirname, './fixtures/query.graphql'), 'utf8');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getGraphQLHeadersWithPerson
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
                .post('/4_0_0/Subscription/1/$merge?validate=true')
                .send(subscription1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Subscription/subscription1')
                .set(getHeaders());

            resp = await request
                .post('/4_0_0/SubscriptionStatus/1/$merge?validate=true')
                .send(subscriptionStatus1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patientBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(personBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

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
    });
});