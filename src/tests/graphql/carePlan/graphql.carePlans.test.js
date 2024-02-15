const carePlanBundleResource = require('./fixtures/carePlans.json');
const expectedCarePlanBundleResource = require('./fixtures/expected_carePlans.json');

const patientBundleResource = require('./fixtures/patients.json');

const observationResource = require('./fixtures/observation.json');

const fs = require('fs');
const path = require('path');

const carePlanQuery = fs.readFileSync(path.resolve(__dirname, './fixtures/query.graphql'), 'utf8');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getGraphQLHeaders,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { logInfo } = require('../../../operations/common/logging');

describe('GraphQL CarePlan Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('GraphQL CarePlan', () => {
        test('GraphQL CarePlan properly', async () => {
            const request = await createTestRequest();
            const graphqlQueryText = carePlanQuery.replace(/\\n/g, '');
            let resp = await request.get('/4_0_0/CarePlan').set(getHeaders()).expect(200);
            expect(resp.body.length).toBe(0);
            logInfo('------- response 1 ------------');
            logInfo('', { 'resp': resp.body });
            logInfo('------- end response 1 ------------');

            resp = await request
                .post('/4_0_0/Patient/1/$merge')
                .send(patientBundleResource)
                .set(getHeaders())
                .expect(400);

            logInfo('------- response 2 ------------');
            logInfo('', { 'resp': resp.body });
            logInfo('------- end response 2  ------------');
            resp = await request
                .post('/4_0_0/CarePlan/1/$merge')
                .send(carePlanBundleResource)
                .set(getHeaders())
                .expect(200);
            logInfo('------- response 2 ------------');
            logInfo('', { 'resp': resp.body });
            logInfo('------- end response 2  ------------');
            resp = await request.get('/4_0_0/Patient/').set(getHeaders()).expect(200);

            resp = await request.post('/4_0_0/Observation/1/$merge').send(observationResource).set(getHeaders());
            resp = await request.get('/4_0_0/Observation/').set(getHeaders()).expect(200);
            expect(resp.body.length).toBe(1);
            logInfo('------- response observation ------------');
            logInfo('', { 'resp': resp.body });
            logInfo('------- end response observation ------------');

            logInfo('------- response patient ------------');
            logInfo('', { 'resp': resp.body });
            logInfo('------- end response patient  ------------');
            resp = await request.get('/4_0_0/CarePlan/').set(getHeaders()).expect(200);
            logInfo('------- response 2 ------------');
            logInfo('', { 'resp': resp.body });
            logInfo('------- end response 2  ------------');
            resp = await request
                // .get('/graphql/?query=' + graphqlQueryText)
                // .set(getHeaders())
                .post('/graphql')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText
                })
                .set(getGraphQLHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedCarePlanBundleResource);
        });
    });
});
