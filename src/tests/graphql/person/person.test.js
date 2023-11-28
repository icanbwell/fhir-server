const expectedGraphQlPersonResponse = require('./fixtures/expected_graphql_person_response.json');
const expectedPersonResponseWithIndexHint1 = require('./fixtures/expected_person_response_with_indexhint1.json');
const expectedPersonResponseWithIndexHint2 = require('./fixtures/expected_person_response_with_indexhint2.json');

const patientBundleResource = require('./fixtures/patient_bundle.json');
const personBundleResource = require('./fixtures/person_bundle.json');

const fs = require('fs');
const path = require('path');

// eslint-disable-next-line security/detect-non-literal-fs-filename
const personQuery = fs.readFileSync(
    path.resolve(__dirname, './fixtures/query_person.graphql'),
    'utf8'
);
const personQueryWithIndexHint1 = fs.readFileSync(
    path.resolve(__dirname, './fixtures/query_person_with_indexhint_1.graphql'),
    'utf8'
);
const personQueryWithIndexHint2 = fs.readFileSync(
    path.resolve(__dirname, './fixtures/query_person_with_indexhint_2.graphql'),
    'utf8'
);

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getGraphQLHeaders,
    createTestRequest, getTestContainer,
} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');
const {cleanMeta} = require('../../customMatchers');
const {logInfo} = require('../../../operations/common/logging');

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

            /**
             * @type {SimpleContainer}
             */
            const testContainer = getTestContainer();

            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = testContainer.postRequestProcessor;
            await postRequestProcessor.waitTillAllRequestsDoneAsync({timeoutInSeconds: 20});
            /**
             * @type {RequestSpecificCache}
             */
            const requestSpecificCache = testContainer.requestSpecificCache;
            await requestSpecificCache.clearAllAsync();

            resp = await request
                .post('/graphql')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText,
                })
                .set(getGraphQLHeaders());

            logInfo('', {'resp': resp.body});

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedGraphQlPersonResponse, r => {
                if (r.person) {
                    r.person.forEach(resource => {
                        cleanMeta(resource);
                    });
                }
                return r;
            });
            expect(resp.headers['x-request-id']).toBeDefined();

            // uncomment this to test out timing of events
            // await new Promise(resolve => setTimeout(resolve, 30 * 1000));
        });

        test('GraphQL IndexHint Tests', async () => {
            const request = await createTestRequest();
            const graphqlQueryTextWithIndexHint1 = personQueryWithIndexHint1.replace(/\\n/g, '');
            const graphqlQueryTextWithIndexHint2 = personQueryWithIndexHint2.replace(/\\n/g, '');

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

            /**
             * @type {SimpleContainer}
             */
            const testContainer = getTestContainer();

            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = testContainer.postRequestProcessor;
            await postRequestProcessor.waitTillAllRequestsDoneAsync({timeoutInSeconds: 20});
            /**
             * @type {RequestSpecificCache}
             */
            const requestSpecificCache = testContainer.requestSpecificCache;
            await requestSpecificCache.clearAllAsync();

            resp = await request
                .post('/graphql')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryTextWithIndexHint1,
                })
                .set(getGraphQLHeaders());

            const foundIndex1 = resp.data.person.meta.tag.find(tag => tag.system === 'https://www.icanbwell.com/queryIndexHint').code;
            const expectedIndex1 = expectedPersonResponseWithIndexHint1.data.person.meta.tag.find(tag => tag.system === 'https://www.icanbwell.com/queryIndexHint').code;

            expect(foundIndex1).toEqual(expectedIndex1);

            resp = await request
                .post('/graphql')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryTextWithIndexHint2,
                })
                .set(getGraphQLHeaders());

            const foundIndex2 = resp.data.person.meta.tag.find(tag => tag.system === 'https://www.icanbwell.com/queryIndexHint').code;
            const expectedIndex2 = expectedPersonResponseWithIndexHint2.data.person.meta.tag.find(tag => tag.system === 'https://www.icanbwell.com/queryIndexHint').code;

            expect(foundIndex2).toEqual(expectedIndex2);
        });
    });
});
