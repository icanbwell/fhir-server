const explanationOfBenefitBundleResource = require('./fixtures/explanationOfBenefit.json');
const organizationBundleResource = require('./fixtures/organization.json');
const practitionerBundleResource = require('./fixtures/practitioner.json');
const expectedGraphQLResponse = require('./fixtures/expectedResponse.json');

const fs = require('fs');
const path = require('path');

const fragmentQuery = fs.readFileSync(
    path.resolve(__dirname, './fixtures/query_fragment.graphql'),
    'utf8'
);

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getGraphQLHeaders,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('GraphQL Fragment Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('GraphQL Fragments', () => {
        test('GraphQL Fragment spread with reference', async () => {
            const request = await createTestRequest();
            const graphqlQueryText = fragmentQuery.replace(/\\n/g, '');

            let resp = await request
                .post('/4_0_0/Organization/$merge')
                .send(organizationBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({});

            resp = await request
                .post('/4_0_0/Practitioner/$merge')
                .send(practitionerBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/ExplanationOfBenefit/$merge')
                .send(explanationOfBenefitBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request.get('/4_0_0/Organization/').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(2);

            resp = await request.get('/4_0_0/Practitioner/').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(2);

            resp = await request.get('/4_0_0/ExplanationOfBenefit/').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(3);

            resp = await request
                .post('/$graphql')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText
                })
                .set(getGraphQLHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedGraphQLResponse);
        });
    });
});
