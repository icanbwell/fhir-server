const fs = require('fs');
const path = require('path');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getGraphQLHeaders,
    createTestRequest
} = require('../../common');

const conditionBundleResource = require('./fixtures/conditions.json');
const patientBundleResource = require('./fixtures/patients.json');

const expectedConditionBundleWithReferenceStringResource = require('./fixtures/expected_condition_with_string.json');
const expectedConditionBundleWithReferenceResourceResource = require('./fixtures/expected_condition_with_resource.json');

const conditionQueryWithReferenceString = fs.readFileSync(
    path.resolve(__dirname, './fixtures/query_reference_string.graphql'),
    'utf8'
);
const conditionQueryWithReferenceResource = fs.readFileSync(
    path.resolve(__dirname, './fixtures/query_reference_resource.graphql'),
    'utf8'
);

describe('GraphQL Reference as string tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('GraphQL get reference field as string only', async () => {
        const request = await createTestRequest();
        const graphqlQueryText = conditionQueryWithReferenceString.replace(/\\n/g, '');
        let resp = await request.get('/4_0_0/Condition').set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResourceCount(0);

        resp = await request
            .post('/4_0_0/Patient/1/$merge')
            .send(patientBundleResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Condition/1/$merge')
            .send(conditionBundleResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request.get('/4_0_0/Patient/').set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResourceCount(1);

        resp = await request.get('/4_0_0/Condition/').set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResourceCount(10);

        resp = await request
            .post('/4_0_0/$graphqlv2')
            .send({
                operationName: null,
                variables: {},
                query: graphqlQueryText
            })
            .set(getGraphQLHeaders());

        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedConditionBundleWithReferenceStringResource);
    });

    test('GraphQL get reference field as string along with referenced resource', async () => {
        const request = await createTestRequest();
        const graphqlQueryText = conditionQueryWithReferenceResource.replace(/\\n/g, '');
        let resp = await request.get('/4_0_0/Condition').set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResourceCount(0);

        resp = await request
            .post('/4_0_0/Patient/1/$merge')
            .send(patientBundleResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Condition/1/$merge')
            .send(conditionBundleResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request.get('/4_0_0/Patient/').set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResourceCount(1);

        resp = await request.get('/4_0_0/Condition/').set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResourceCount(10);

        resp = await request
            .post('/4_0_0/$graphqlv2')
            .send({
                operationName: null,
                variables: {},
                query: graphqlQueryText
            })
            .set(getGraphQLHeaders());

        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedConditionBundleWithReferenceResourceResource);
    });
});
