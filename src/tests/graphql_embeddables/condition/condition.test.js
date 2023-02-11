// test file
const condition1Resource = require('./fixtures/Condition/condition1.json');
const patientBundleResource = require('./fixtures/Patient/patient1.json');
const personBundleResource = require('./fixtures/Person/person1.json');

// expected
const expectedConditionResources = require('./fixtures/expected/expected_condition.json');

const fs = require('fs');
const path = require('path');

// eslint-disable-next-line security/detect-non-literal-fs-filename
const conditionQuery = fs.readFileSync(path.resolve(__dirname, './fixtures/query.graphql'), 'utf8');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest, getGraphQLHeadersWithPerson,
} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');

describe('GraphQL Condition Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('GraphQL Condition condition Tests', () => {
        test('GraphQL condition works', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Condition/1/$merge?validate=true')
                .send(condition1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patientBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(personBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            const graphqlQueryText = conditionQuery.replace(/\\n/g, '');
            // ACT & ASSERT
            resp = await request
                // .get('/graphql/?query=' + graphqlQueryText)
                // .set(getHeaders())
                .post('/graphqlv2')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText,
                })
                .set(getGraphQLHeadersWithPerson('79e59046-ffc7-4c41-9819-c8ef83275454'));

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveGraphQLResponse(expectedConditionResources, 'condition');
        });
    });
});
