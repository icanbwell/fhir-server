const expectedGraphQlPersonResponse = require('./fixtures/expected_graphql_person_response.json');

const patientBundleResource = require('./fixtures/patient_bundle.json');
const personBundleResource = require('./fixtures/person_bundle.json');

const fs = require('fs');
const path = require('path');

const personQuery = fs.readFileSync(
    path.resolve(__dirname, './fixtures/query_person.graphql'),
    'utf8'
);

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getGraphQLHeaders,
    createTestRequest, getTestContainer
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { cleanMeta } = require('../../customMatchers');
const { logInfo } = require('../../../operations/common/logging');

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
            expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

            resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send(personBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

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
            await postRequestProcessor.waitTillAllRequestsDoneAsync({ timeoutInSeconds: 20 });
            /**
             * @type {RequestSpecificCache}
             */
            const requestSpecificCache = testContainer.requestSpecificCache;
            await requestSpecificCache.clearAllAsync();

            resp = await request
                .post('/4_0_0/$graphqlv2')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText
                })
                .set(getGraphQLHeaders());

            logInfo('', { resp: resp.body });

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
            expect(
                resp.body.data.person.meta.tag.find(
                    t => t.system === 'https://www.icanbwell.com/query'
                ).display
            ).toEqual("[db.Person_4_0_0.find({'$and':[{'identifier':{'$elemMatch':{'system':'http://www.client.com/profileid','value':'healthsystemId1'}}},{'meta.tag':{'$not':{'$elemMatch':{'system':'https://fhir.icanbwell.com/4_0_0/CodeSystem/server-behavior','code':'hidden'}}}}]}, {}).sort({'_uuid':1}).limit(100),db.Patient_4_0_0.find({'_uuid':'6bcdef66-b41c-413b-b9e3-40ffe20dd18e'}, {}).sort({'_uuid':1}).limit(1000)]");

            // uncomment this to test out timing of events
            // await new Promise(resolve => setTimeout(resolve, 30 * 1000));
        });
    });
});
