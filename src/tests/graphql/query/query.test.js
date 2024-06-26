// test file
const observation1Resource = require('./fixtures/observation/observation1.json');
const observation2Resource = require('./fixtures/observation/observation2.json');
const observation3Resource = require('./fixtures/observation/observation3.json');
const patientBundleResource = require('./fixtures/patient/patient1.json');
const personBundleResource = require('./fixtures/person/person1.json');

// expected
const expectedResponse1 = require('./fixtures/expected/expected_response1.json');
const expectedResponse2 = require('./fixtures/expected/expected_response2.json');
const expectedResponse3 = require('./fixtures/expected/expected_response3.json');

const fs = require('fs');
const path = require('path');

const searchExtensionQueryValue = fs.readFileSync(
    path.resolve(__dirname, './fixtures/searchExtensionQueryValue.graphql'),
    'utf8'
);
const searchExtensionQueryValues = fs.readFileSync(
    path.resolve(__dirname, './fixtures/searchExtensionQueryValues.graphql'),
    'utf8'
);
const searchExtensionQueryNotEquals = fs.readFileSync(
    path.resolve(__dirname, './fixtures/searchExtensionQueryNotEquals.graphql'),
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
        test('GraphQL Extension queries Test', async () => {
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
                .post('/4_0_0/Observation/3/$merge?validate=true')
                .send(observation3Resource)
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

            let graphqlQueryText = searchExtensionQueryValue.replace(/\\n/g, '');
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

            graphqlQueryText = searchExtensionQueryValues.replace(/\\n/g, '');
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

            graphqlQueryText = searchExtensionQueryNotEquals.replace(/\\n/g, '');
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
    });
});
