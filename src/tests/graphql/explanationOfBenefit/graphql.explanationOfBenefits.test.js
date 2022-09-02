const explanationOfBenefitBundleResource = require('./fixtures/explanation_of_benefits.json');
const expectedGraphQLResponse = require('./fixtures/expected_graphql_response.json');

const patientBundleResource = require('./fixtures/patients.json');
const organizationBundleResource = require('./fixtures/organizations.json');
const coverageBundleResource = require('./fixtures/coverages.json');

const fs = require('fs');
const path = require('path');

// eslint-disable-next-line security/detect-non-literal-fs-filename
const explanationOfBenefitQuery = fs.readFileSync(
    path.resolve(__dirname, './fixtures/query.graphql'),
    'utf8'
);

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getGraphQLHeaders,
    createTestRequest,
} = require('../../common');
const {describe, beforeEach, afterEach} = require('@jest/globals');
const {expectResponse, expectResourceCount, expectMergeResponse} = require('../../fhirAsserts');

describe('GraphQL ExplanationOfBenefit Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('GraphQL ExplanationOfBenefit', () => {
        test('GraphQL ExplanationOfBenefit properly', async () => {
            const request = await createTestRequest();
            const graphqlQueryText = explanationOfBenefitQuery.replace(/\\n/g, '');
            let resp = await request
                .get('/4_0_0/ExplanationOfBenefit')
                .set(getHeaders());
            expectResourceCount(resp, 0);

            resp = await request
                .post('/4_0_0/Patient/1/$merge')
                .send(patientBundleResource)
                .set(getHeaders());
            expectMergeResponse(resp, {created: true});

            resp = await request
                .post('/4_0_0/Organization/1/$merge')
                .send(organizationBundleResource)
                .set(getHeaders());
            expectMergeResponse(resp, {created: true});

            resp = await request
                .post('/4_0_0/Coverage/1/$merge')
                .send(coverageBundleResource)
                .set(getHeaders());
            expectMergeResponse(resp, {created: true});

            resp = await request
                .post('/4_0_0/ExplanationOfBenefit/1/$merge')
                .send(explanationOfBenefitBundleResource)
                .set(getHeaders());
            expectMergeResponse(resp, {created: true});

            resp = await request.get('/4_0_0/Patient/').set(getHeaders());
            expectResourceCount(resp, 0);

            resp = await request.get('/4_0_0/ExplanationOfBenefit/').set(getHeaders());
            expectResourceCount(resp, 0);

            resp = await request
                // .get('/graphql/?query=' + graphqlQueryText)
                // .set(getHeaders())
                .post('/graphqlv2')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText,
                })
                .set(getGraphQLHeaders());

            expectResponse(resp, expectedGraphQLResponse[0], (r) => {
                delete r['meta'];
                return r;
            });
        });
    });
});
