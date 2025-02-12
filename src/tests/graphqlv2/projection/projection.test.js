const fs = require('fs');
const path = require('path');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getGraphQLHeaders,
    getGraphQLHeadersWithPerson,
    createTestRequest
} = require('../../common');

// test file
const observation1Resource = require('./fixtures/observation/observation1.json');
const patientBundleResource = require('./fixtures/patient/patient1.json');
const personBundleResource = require('./fixtures/person/person1.json');
const patientProjectionQuery = fs.readFileSync(
    path.resolve(__dirname, './fixtures/query.graphql'),
    'utf8'
);

// expected
const expectedResponse = require('./fixtures/expected/expected_response.json');
const expectedPatientScopeResponse = require('./fixtures/expected/expected_patient_scope_response.json');

describe('GraphQL Projections Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('GraphQL Projection work for both patient and non patient scope', async () => {
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

        const graphqlQueryText = patientProjectionQuery.replace(/\\n/g, '');
        // ACT & ASSERT

        resp = await request
            .post('/4_0_0/$graphqlv2')
            .send({
                operationName: null,
                variables: {
                    FHIR_DEFAULT_COUNT: 10
                },
                query: graphqlQueryText
            })
            .set(getGraphQLHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedResponse);

        resp = await request
            .post('/4_0_0/$graphqlv2')
            .send({
                operationName: null,
                variables: {
                    FHIR_DEFAULT_COUNT: 10
                },
                query: graphqlQueryText
            })
            .set(getGraphQLHeadersWithPerson('79e59046-ffc7-4c41-9819-c8ef83275454'));
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedPatientScopeResponse);
    });
});
