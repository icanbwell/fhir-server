const expectedGraphQlWithoutFilterResponse = require('./fixtures/expected/expected_graphql_response_without_filter.json');
const expectedGraphQlWithFilterResponse = require('./fixtures/expected/expected_graphql_response_with_filter.json');
const expectedGraphQlWithFilterBinaryResponse = require('./fixtures/expected/expected_graphql_response_with_filter_binary.json');
const expectedGraphQlWithFilterWithVariableErrorResponse = require('./fixtures/expected/expected_graphql_response_with_filter_missing_variable.json');

const codeSystem1Resource = require('./fixtures/codeSystem/codeSystem1.json');
const codeSystem1WithBinaryResource = require('./fixtures/codeSystem/codeSystem1WithBinary.json');

const rootPersonResource = require('./fixtures/person/person.root.json');
const person123aResource = require('./fixtures/person/person.123a.json');
const binary1Resource = require('./fixtures/binary/binary1.json');

const fs = require('fs');
const path = require('path');

const codeSystemQueryWithoutFilter = fs.readFileSync(
    path.resolve(__dirname, './fixtures/query_codesystem_without_filter.graphql'),
    'utf8'
);

const codeSystemQueryWithFilter = fs.readFileSync(
    path.resolve(__dirname, './fixtures/query_codesystem_with_filter.graphql'),
    'utf8'
);

const getCodeSystemCodesQueryWithFilter = fs.readFileSync(
    path.resolve(__dirname, './fixtures/query_getcodesystemcodes_with_filter.graphql'),
    'utf8'
);
const getCodeSystemCodesQueryWithFilterWithDefaultValue = fs.readFileSync(
    path.resolve(__dirname, './fixtures/query_getcodesystemcodes_with_filter_with_default_value.graphql'),
    'utf8'
);

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getGraphQLHeaders,
    createTestRequest, getTestContainer, getCustomGraphQLHeaders
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { cleanMeta } = require('../../customMatchers');
const { logInfo } = require('../../../operations/common/logging');

describe('GraphQL CodeSystem Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('GraphQL CodeSystem', () => {
        test('GraphQL Codeset without filter works properly', async () => {
            const request = await createTestRequest();
            const graphqlQueryText = codeSystemQueryWithoutFilter.replace(/\\n/g, '');

            let resp = await request
                .post('/4_0_0/CodeSystem/1/$merge')
                .send(codeSystem1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

            /**
             * @type {SimpleContainer}
             */
            const testContainer = getTestContainer();

            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = testContainer.postRequestProcessor;
            await postRequestProcessor.waitTillAllRequestsDoneAsync({ timeoutInSeconds: 20 });
            /**
             * @type {RequestSpecificCache}
             */
            const requestSpecificCache = testContainer.requestSpecificCache;
            await requestSpecificCache.clearAllAsync();

            resp = await request
                .post('/$graphql')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText
                })
                .set(getGraphQLHeaders());

            logInfo('', { resp: resp.body });

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedGraphQlWithoutFilterResponse, r => {
                if (r.codeSystem) {
                    r.codeSystem.forEach(resource => {
                        cleanMeta(resource);
                    });
                }
                return r;
            });
            expect(resp.headers['x-request-id']).toBeDefined();

            // uncomment this to test out timing of events
            // await new Promise(resolve => setTimeout(resolve, 30 * 1000));
        });
        test('GraphQL Codeset with filter works properly', async () => {
            const request = await createTestRequest();
            const graphqlQueryText = codeSystemQueryWithFilter.replace(/\\n/g, '');

            let resp = await request
                .post('/4_0_0/CodeSystem/1/$merge')
                .send(codeSystem1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

            /**
             * @type {SimpleContainer}
             */
            const testContainer = getTestContainer();

            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = testContainer.postRequestProcessor;
            await postRequestProcessor.waitTillAllRequestsDoneAsync({ timeoutInSeconds: 20 });
            /**
             * @type {RequestSpecificCache}
             */
            const requestSpecificCache = testContainer.requestSpecificCache;
            await requestSpecificCache.clearAllAsync();

            resp = await request
                .post('/$graphql')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText
                })
                .set({ 'X-Request-Id': 'd4c5546f-cd8a-4447-83e0-201f0da08bef', ...getGraphQLHeaders() });

            logInfo('', { resp: resp.body });

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedGraphQlWithFilterResponse, r => {
                if (r.codeSystem) {
                    r.codeSystem.forEach(resource => {
                        cleanMeta(resource);
                    });
                }
                return r;
            });
            expect(resp.headers['x-request-id']).toBeDefined();
            expect(resp.headers['x-request-id']).toEqual('d4c5546f-cd8a-4447-83e0-201f0da08bef');

            // uncomment this to test out timing of events
            // await new Promise(resolve => setTimeout(resolve, 30 * 1000));
        });
        test('GraphQL Codeset with filter works properly with patient scope', async () => {
            const request = await createTestRequest();
            const graphqlQueryText = codeSystemQueryWithFilter.replace(/\\n/g, '');

            let resp = await request
                .post('/4_0_0/CodeSystem/1/$merge')
                .send(codeSystem1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

            // add persons
            resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send(rootPersonResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);
            resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send(person123aResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);
            /**
             * @type {SimpleContainer}
             */
            const testContainer = getTestContainer();

            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = testContainer.postRequestProcessor;
            await postRequestProcessor.waitTillAllRequestsDoneAsync({ timeoutInSeconds: 20 });
            /**
             * @type {RequestSpecificCache}
             */
            const requestSpecificCache = testContainer.requestSpecificCache;
            await requestSpecificCache.clearAllAsync();

            const only_fhir_person_payload = {
                scope: 'patient/*.read user/*.* access/*.*',
                username: 'patient-123@example.com',
                clientFhirPersonId: 'clientFhirPerson',
                clientFhirPatientId: 'clientFhirPatient',
                bwellFhirPersonId: 'root-person',
                bwellFhirPatientId: 'bwellFhirPatient',
                token_use: 'access'
         };

            resp = await request
                .post('/$graphql')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText
                })
                .set(getCustomGraphQLHeaders(only_fhir_person_payload));

            logInfo('', { resp: resp.body });

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedGraphQlWithFilterResponse, r => {
                if (r.codeSystem) {
                    r.codeSystem.forEach(resource => {
                        cleanMeta(resource);
                    });
                }
                return r;
            });
            expect(resp.headers['x-request-id']).toBeDefined();

            // uncomment this to test out timing of events
            // await new Promise(resolve => setTimeout(resolve, 30 * 1000));
        });
        test('GraphQL Codeset with filter works with binary data with patient scope', async () => {
            const request = await createTestRequest();
            const graphqlQueryText = codeSystemQueryWithFilter.replace(/\\n/g, '');

            let resp = await request
                .post('/4_0_0/CodeSystem/1/$merge')
                .send(codeSystem1WithBinaryResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

            resp = await request
                .post('/4_0_0/Binary/1/$merge')
                .send(binary1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

            // add persons
            resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send(rootPersonResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

            resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send(person123aResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);
            /**
             * @type {SimpleContainer}
             */
            const testContainer = getTestContainer();

            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = testContainer.postRequestProcessor;
            await postRequestProcessor.waitTillAllRequestsDoneAsync({ timeoutInSeconds: 20 });
            /**
             * @type {RequestSpecificCache}
             */
            const requestSpecificCache = testContainer.requestSpecificCache;
            await requestSpecificCache.clearAllAsync();

            const only_fhir_person_payload = {
                scope: 'patient/*.read user/*.* access/*.*',
                username: 'patient-123@example.com',
                clientFhirPersonId: 'clientFhirPerson',
                clientFhirPatientId: 'clientFhirPatient',
                bwellFhirPersonId: 'root-person',
                bwellFhirPatientId: 'bwellFhirPatient',
                token_use: 'access'
           };

            resp = await request
                .post('/$graphql')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText
                })
                .set(getCustomGraphQLHeaders(only_fhir_person_payload));

            logInfo('', { resp: resp.body });

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedGraphQlWithFilterBinaryResponse, r => {
                if (r.codeSystem) {
                    r.codeSystem.forEach(resource => {
                        cleanMeta(resource);
                    });
                }
                return r;
            });
            expect(resp.headers['x-request-id']).toBeDefined();

            // uncomment this to test out timing of events
            // await new Promise(resolve => setTimeout(resolve, 30 * 1000));
        });

        test('GraphQL Codeset with codes filter works properly', async () => {
            const request = await createTestRequest();
            const graphqlQueryText = getCodeSystemCodesQueryWithFilter.replace(/\\n/g, '');

            let resp = await request
                .post('/4_0_0/CodeSystem/1/$merge')
                .send(codeSystem1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

            /**
             * @type {SimpleContainer}
             */
            const testContainer = getTestContainer();

            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = testContainer.postRequestProcessor;
            await postRequestProcessor.waitTillAllRequestsDoneAsync({ timeoutInSeconds: 20 });
            /**
             * @type {RequestSpecificCache}
             */
            const requestSpecificCache = testContainer.requestSpecificCache;
            await requestSpecificCache.clearAllAsync();

            resp = await request
                .post('/$graphql')
                .send({
                    operationName: null,
                    variables: { code: ['3584-4', 'random'], id: ['loinc-consumer'] },
                    query: graphqlQueryText
                })
                .set({ 'X-Request-Id': 'd4c5546f-cd8a-4447-83e0-201f0da08bef', ...getGraphQLHeaders() });

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedGraphQlWithFilterResponse, r => {
                if (r.codeSystem) {
                    r.codeSystem.forEach(resource => {
                        cleanMeta(resource);
                    });
                }
                return r;
            });
            expect(resp.headers['x-request-id']).toBeDefined();
            expect(resp.headers['x-request-id']).toEqual('d4c5546f-cd8a-4447-83e0-201f0da08bef');

            // uncomment this to test out timing of events
            // await new Promise(resolve => setTimeout(resolve, 30 * 1000));
        });
        test('GraphQL Codeset with codes filter throws missing variable values error', async () => {
            const request = await createTestRequest();
            let graphqlQueryText = getCodeSystemCodesQueryWithFilter.replace(/\\n/g, '');

            let resp = await request
                .post('/4_0_0/CodeSystem/1/$merge')
                .send(codeSystem1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

            /**
             * @type {SimpleContainer}
             */
            const testContainer = getTestContainer();

            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = testContainer.postRequestProcessor;
            await postRequestProcessor.waitTillAllRequestsDoneAsync({ timeoutInSeconds: 20 });
            /**
             * @type {RequestSpecificCache}
             */
            const requestSpecificCache = testContainer.requestSpecificCache;
            await requestSpecificCache.clearAllAsync();

            resp = await request
                .post('/$graphql')
                .send({
                    operationName: null,
                    variables: { id: ['loinc-consumer'] },
                    query: graphqlQueryText
                })
                .set({ handling: 'strict', ...getGraphQLHeaders() });

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedGraphQlWithFilterWithVariableErrorResponse);

            graphqlQueryText = getCodeSystemCodesQueryWithFilterWithDefaultValue.replace(/\\n/g, '');
            resp = await request
                .post('/$graphql')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText
                })
                .set({ handling: 'strict', ...getGraphQLHeaders() });

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedGraphQlWithFilterWithVariableErrorResponse);
        });
        test('GraphQL Codeset with filter works with binary data with patient scope', async () => {
            const request = await createTestRequest();
            const graphqlQueryText = getCodeSystemCodesQueryWithFilter.replace(/\\n/g, '');

            let resp = await request
                .post('/4_0_0/CodeSystem/1/$merge')
                .send(codeSystem1WithBinaryResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

            resp = await request
                .post('/4_0_0/Binary/1/$merge')
                .send(binary1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

            // add persons
            resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send(rootPersonResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

            resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send(person123aResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);
            /**
             * @type {SimpleContainer}
             */
            const testContainer = getTestContainer();

            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = testContainer.postRequestProcessor;
            await postRequestProcessor.waitTillAllRequestsDoneAsync({ timeoutInSeconds: 20 });
            /**
             * @type {RequestSpecificCache}
             */
            const requestSpecificCache = testContainer.requestSpecificCache;
            await requestSpecificCache.clearAllAsync();

            const only_fhir_person_payload = {
                scope: 'patient/*.read user/*.* access/*.*',
                username: 'patient-123@example.com',
                clientFhirPersonId: 'clientFhirPerson',
                clientFhirPatientId: 'clientFhirPatient',
                bwellFhirPersonId: 'root-person',
                bwellFhirPatientId: 'bwellFhirPatient',
                token_use: 'access'
            };

            resp = await request
                .post('/$graphql')
                .send({
                    operationName: null,
                    variables: { id: ['loinc-consumer'], code: ['3584-4', 'random'] },
                    query: graphqlQueryText
                })
                .set(getCustomGraphQLHeaders(only_fhir_person_payload));

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedGraphQlWithFilterBinaryResponse, r => {
                if (r.codeSystem) {
                    r.codeSystem.forEach(resource => {
                        cleanMeta(resource);
                    });
                }
                return r;
            });
            expect(resp.headers['x-request-id']).toBeDefined();

            // uncomment this to test out timing of events
            // await new Promise(resolve => setTimeout(resolve, 30 * 1000));
        });
    });
});
