#set($ResourceNameLower = $ResourceName.toLowerCase())
#set($dollar = "$")

// test file
const ${ResourceNameLower}1Resource = require('./fixtures/${ResourceName}/${ResourceNameLower}1.json');
const patientBundleResource = require('./fixtures/Patient/patient1.json');
const personBundleResource = require('./fixtures/Person/person1.json');

// expected
const expected${ResourceName}Resources = require('./fixtures/expected/expected_${ResourceNameLower}.json');

const fs = require('fs');
const path = require('path');

// eslint-disable-next-line security/detect-non-literal-fs-filename
const ${ResourceNameLower}Query = fs.readFileSync(path.resolve(__dirname, './fixtures/query.graphql'), 'utf8');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getGraphQLHeadersWithPerson,
    createTestRequest,
} = require('../../common');
const { describe, beforeEach, afterEach, test } = require('@jest/globals');

describe('GraphQL ${ResourceName} Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('GraphQL ${ResourceName} ${NAME} Tests', () => {
        test('GraphQL ${NAME} works', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/${ResourceName}/1/${dollar}merge?validate=true')
                .send(${ResourceNameLower}1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });
            
           resp = await request
                .post('/4_0_0/Patient/1/${dollar}merge?validate=true')
                .send(patientBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Person/1/${dollar}merge?validate=true')
                .send(personBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});
            
            const graphqlQueryText = ${ResourceNameLower}Query.replace(/\\n/g, '');
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
            expect(resp).toHaveGraphQLResponse(expected${ResourceName}Resources, '{query name from query.graphql}');
        });
    });
});
