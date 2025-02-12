const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getGraphQLHeaders
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

// test file
const medicationStatementResource = require('./fixtures/MedicationStatement/medicationStatement.json');
const medicationResource = require('./fixtures/medication/medication.json');

// expected
const expectedSubscriptionResources = require('./fixtures/expected/expectedResponse.json');

const fs = require('fs');
const path = require('path');

const medicationStatementV2FieldQuery = fs.readFileSync(
    path.resolve(__dirname, './fixtures/query.graphql'),
    'utf8'
);

describe('GraphQL v2 field test', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('GraphQL V2 field work with projections', async () => {
        const request = await createTestRequest();
        // ARRANGE
        // add the resources to FHIR server
        resp = await request
            .post('/4_0_0/MedicationStatement/$merge')
            .send(medicationStatementResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Medication/$merge')
            .send(medicationResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        const graphqlQueryText = medicationStatementV2FieldQuery.replace(/\\n/g, '');
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
            .set(getGraphQLHeaders());

        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedSubscriptionResources);
    });
});
