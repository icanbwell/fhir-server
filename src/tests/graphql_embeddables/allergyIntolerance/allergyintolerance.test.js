// test file
const allergyintolerance1Resource = require('./fixtures/AllergyIntolerance/allergyintolerance1.json');
const patientBundleResource = require('./fixtures/Patient/patient1.json');
const personBundleResource = require('./fixtures/Person/person1.json');

// expected
const expectedAllergyIntoleranceResources = require('./fixtures/expected/expected_allergyintolerance.json');

const fs = require('fs');
const path = require('path');

// eslint-disable-next-line security/detect-non-literal-fs-filename
const allergyintoleranceQuery = fs.readFileSync(path.resolve(__dirname, './fixtures/query.graphql'), 'utf8');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getGraphQLHeadersWithPerson,
    createTestRequest,
} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');

describe('GraphQL AllergyIntolerance Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('GraphQL AllergyIntolerance allergyIntolerance Tests', () => {
        test('GraphQL allergyIntolerance works', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/AllergyIntolerance/1/$merge?validate=true')
                .send(allergyintolerance1Resource)
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

            const graphqlQueryText = allergyintoleranceQuery.replace(/\\n/g, '');
            // ACT & ASSERT
            resp = await request
                // .get('/graphql/?query=' + graphqlQueryText)
                // .set(getHeaders())
                .post('/graphqlv2')
                .send({
                    operationName: null,
                    variables: {
                        FHIR_DEFAULT_COUNT: 10
                    },
                    query: graphqlQueryText,
                })
                .set(getGraphQLHeadersWithPerson('79e59046-ffc7-4c41-9819-c8ef83275454'));

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveGraphQLResponse(expectedAllergyIntoleranceResources, 'allergyIntolerance');
        });
    });
});
