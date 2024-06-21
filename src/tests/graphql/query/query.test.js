// test file
const observation1Resource = require('./fixtures/observation/observation1.json');
const observation2Resource = require('./fixtures/observation/observation2.json');
const patientBundleResource = require('./fixtures/patient/patient1.json');
const personBundleResource = require('./fixtures/person/person1.json');
const condition1Resource = require('./fixtures/condition/condition1.json');

// expected
const expectedResponse1 = require('./fixtures/expected/expected_response1.json');
const expectedResponse2 = require('./fixtures/expected/expected_response2.json');
const expectedResponse3 = require('./fixtures/expected/expected_response3.json');
const expectedResponse4 = require('./fixtures/expected/expected_response4.json');
const expectedResponse5 = require('./fixtures/expected/expected_response5.json');

const fs = require('fs');
const path = require('path');

const searchTokenQuery = fs.readFileSync(
    path.resolve(__dirname, './fixtures/searchTokenQuery.graphql'),
    'utf8'
);
const searchTokenQueryMissing = fs.readFileSync(
    path.resolve(__dirname, './fixtures/searchTokenQueryMissing.graphql'),
    'utf8'
);
const searchStringQuery = fs.readFileSync(
    path.resolve(__dirname, './fixtures/searchStringQuery.graphql'),
    'utf8'
);
const searchReferenceQuery = fs.readFileSync(
    path.resolve(__dirname, './fixtures/searchReferenceQuery.graphql'),
    'utf8'
);
const searchQuantityQuery = fs.readFileSync(
    path.resolve(__dirname, './fixtures/searchQuantityQuery.graphql'),
    'utf8'
);

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getGraphQLHeadersWithPerson,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('GraphQL Input Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('GraphQL Input queries Tests', () => {
        test('GraphQL SearchToken Test', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Observation/2/$merge?validate=true')
                .send(observation2Resource)
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

            const graphqlQueryText = searchTokenQuery.replace(/\\n/g, '');
            // ACT & ASSERT
            resp = await request
                .post('/$graphql')
                .send({
                    operationName: null,
                    variables: {
                        FHIR_DEFAULT_COUNT: 10
                    },
                    query: graphqlQueryText
                })
                .set(getGraphQLHeadersWithPerson('79e59046-ffc7-4c41-9819-c8ef83275454'));

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse1);

            const graphqlQueryMissingText = searchTokenQueryMissing.replace(/\\n/g, '');
            resp = await request
                .post('/$graphql')
                .send({
                    operationName: null,
                    variables: {
                        FHIR_DEFAULT_COUNT: 10
                    },
                    query: graphqlQueryMissingText
                })
                .set(getGraphQLHeadersWithPerson('79e59046-ffc7-4c41-9819-c8ef83275454'));

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse5);
        });

        test('GraphQL SearchString Test', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(personBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            const graphqlQueryText = searchStringQuery.replace(/\\n/g, '');
            // ACT & ASSERT
            resp = await request
                .post('/$graphql')
                .send({
                    operationName: null,
                    variables: {
                        FHIR_DEFAULT_COUNT: 10
                    },
                    query: graphqlQueryText
                })
                .set(getGraphQLHeadersWithPerson('79e59046-ffc7-4c41-9819-c8ef83275454'));

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse2);
        });

        test('GraphQL SearchReference Test', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Observation/2/$merge?validate=true')
                .send(observation2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(personBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            const graphqlQueryText = searchReferenceQuery.replace(/\\n/g, '');
            // ACT & ASSERT
            resp = await request
                .post('/$graphql')
                .send({
                    operationName: null,
                    variables: {
                        FHIR_DEFAULT_COUNT: 10
                    },
                    query: graphqlQueryText
                })
                .set(getGraphQLHeadersWithPerson('79e59046-ffc7-4c41-9819-c8ef83275454'));

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse3);
        });

        test('GraphQL SearchQuantity Test', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Condition/1/$merge?validate=true')
                .send(condition1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(personBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            const graphqlQueryText = searchQuantityQuery.replace(/\\n/g, '');
            // ACT & ASSERT
            resp = await request
                .post('/$graphql')
                .send({
                    operationName: null,
                    variables: {
                        FHIR_DEFAULT_COUNT: 10
                    },
                    query: graphqlQueryText
                })
                .set(getGraphQLHeadersWithPerson('79e59046-ffc7-4c41-9819-c8ef83275454'));

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse4);
        });
    });
});
