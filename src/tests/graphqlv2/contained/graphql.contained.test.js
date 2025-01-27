const conditionResourceWithContained = require('./fixtures/conditions.json');
const expectedConditionBundleResource = require('./fixtures/expected_conditions.json');

const fs = require('fs');
const path = require('path');

const conditionContainedQuery = fs.readFileSync(
    path.resolve(__dirname, './fixtures/query.graphql'),
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

describe('GraphQL Contained Field Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });
    test('GraphQL Condition Contained Field test', async () => {
        const request = await createTestRequest();
        const graphqlQueryText = conditionContainedQuery.replace(/\\n/g, '');

        resp = await request
            .post('/4_0_0/Condition/1/$merge')
            .send(conditionResourceWithContained)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            // .get('/$graphql/?query=' + graphqlQueryText)
            // .set(getHeaders())
            .post('/4_0_0/$graphqlv2')
            .send({
                operationName: null,
                variables: {},
                query: graphqlQueryText
            })
            .set(getGraphQLHeaders());

        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedConditionBundleResource);
    });
});
