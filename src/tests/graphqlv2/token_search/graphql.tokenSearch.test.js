const fs = require('fs');
const path = require('path');

const conditionBundleResource = require('./fixtures/conditions.json');
const patientBundleResource = require('./fixtures/patients.json');

// expected
const expectedValuesInNotEquals = require('./fixtures/expected_values_in_not_equals.json');
const expectedTextModifier = require('./fixtures/expected_text_modifier.json');
const expectedOfTypeModifier = require('./fixtures/expected_of_type_modifier.json');

// graphql query
const valuesInNotEqualsQuery = fs
    .readFileSync(path.resolve(__dirname, './fixtures/query_values_in_not_equals.graphql'), 'utf8')
    .replace(/\\n/g, '');
const textModifierQuery = fs
    .readFileSync(path.resolve(__dirname, './fixtures/query_text_modifier.graphql'), 'utf8')
    .replace(/\\n/g, '');
const ofTypeModifierQuery = fs
    .readFileSync(path.resolve(__dirname, './fixtures/query_of_type_modifier.graphql'), 'utf8')
    .replace(/\\n/g, '');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getGraphQLHeaders,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('GraphQL Token Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('GraphQL Token Search Tests', async () => {
        const request = await createTestRequest();
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
        expect(resp).toHaveResourceCount(3);

        // test values inside not equals
        resp = await request
            .post('/4_0_0/$graphqlv2')
            .send({
                operationName: null,
                variables: {},
                query: valuesInNotEqualsQuery
            })
            .set(getGraphQLHeaders());

        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedValuesInNotEquals);

        // query using text modifier in token search
        resp = await request
            .post('/4_0_0/$graphqlv2')
            .send({
                operationName: null,
                variables: {},
                query: textModifierQuery
            })
            .set(getGraphQLHeaders());

        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedTextModifier);

        // query using of-type modifier in token search
        resp = await request
            .post('/4_0_0/$graphqlv2')
            .send({
                operationName: null,
                variables: {},
                query: ofTypeModifierQuery
            })
            .set(getGraphQLHeaders());

        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedOfTypeModifier);
    });
});
