// test file
const explanationofbenefit1Resource = require('./fixtures/ExplanationOfBenefit/explanationofbenefit1.json');
const explanationofbenefit2Resource = require('./fixtures/ExplanationOfBenefit/explanationofbenefit2.json');
const patientBundleResource = require('./fixtures/Patient/patient1.json');
const personBundleResource = require('./fixtures/Person/person1.json');

// expected
const expectedExplanationOfBenefitResources = require('./fixtures/expected/expected_explanationofbenefit.json');

const fs = require('fs');
const path = require('path');

const explanationofbenefitQuery = fs.readFileSync(path.resolve(__dirname, './fixtures/query.graphql'), 'utf8');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getGraphQLHeadersWithPerson,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('GraphQL ExplanationOfBenefit Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('GraphQL ExplanationOfBenefit explanationOfBenefit Tests', () => {
        test('GraphQL explanationOfBenefit works', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/ExplanationOfBenefit/1/$merge?validate=true')
                .send(explanationofbenefit1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/ExplanationOfBenefit/1/$merge?validate=true')
                .send(explanationofbenefit2Resource)
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

            const graphqlQueryText = explanationofbenefitQuery.replace(/\\n/g, '');
            // ACT & ASSERT
            resp = await request
                // .get('/$graphql/?query=' + graphqlQueryText)
                // .set(getHeaders())
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
            expect(resp).toHaveGraphQLResponse(expectedExplanationOfBenefitResources, 'explanationOfBenefit');
        });
    });
});
