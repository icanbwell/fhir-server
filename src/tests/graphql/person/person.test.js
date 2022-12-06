const expectedGraphQlPersonResponse = require('./fixtures/expected_graphql_person_response.json');

const patientBundleResource = require('./fixtures/patient_bundle.json');
const personBundleResource = require('./fixtures/person_bundle.json');

const fs = require('fs');
const path = require('path');

// eslint-disable-next-line security/detect-non-literal-fs-filename
const personQuery = fs.readFileSync(
    path.resolve(__dirname, './fixtures/query_person.graphql'),
    'utf8'
);

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getGraphQLHeaders,
    createTestRequest,
} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');
const {cleanMeta} = require('../../customMatchers');

describe('GraphQL Patient Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('GraphQL Person', () => {
        test('GraphQL Person properly', async () => {
            const request = await createTestRequest();
            const graphqlQueryText = personQuery.replace(/\\n/g, '');

            let resp = await request
                .post('/4_0_0/Patient/1/$merge')
                .send(patientBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{created: true}, {created: true}]);

            resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send(personBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{created: true}, {created: true}]);

            resp = await request
                .get('/4_0_0/Patient/')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(1);

            resp = await request
                .post('/graphqlv2')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText,
                })
                .set(getGraphQLHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedGraphQlPersonResponse, r => {
                if (r.person){
                    r.person.forEach(resource => {
                        cleanMeta(resource);
                    });
                }
                return r;
            });
            expect(resp.headers['x-request-id']).toBeDefined();
        });
    });
});
