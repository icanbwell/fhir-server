const carePlanBundleResource = require('./fixtures/carePlans.json');
const carePlanResource = require('./fixtures/carePlan1.json');
const carePlan2Resource = require('./fixtures/carePlan2.json');
const expectedCarePlanBundleResource = require('./fixtures/expected_carePlans.json');
const expectedCarePlanBundle2Resource = require('./fixtures/expected_carePlans2.json');
const expectedCarePlanBundle3Resource = require('./fixtures/expected_carePlans3.json');
const expectedCarePlan1 = require('./fixtures/expected_carePlan1.json');

const observationResource = require('./fixtures/observation.json');

const fs = require('fs');
const path = require('path');
const env = require('var');

const carePlanQuery = fs.readFileSync(path.resolve(__dirname, './fixtures/query.graphql'), 'utf8');
const carePlan2Query = fs.readFileSync(path.resolve(__dirname, './fixtures/query2.graphql'), 'utf8');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getGraphQLHeaders,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

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

            resp = await request
                .post('/4_0_0/CarePlan/1/$merge')
                .send(carePlanBundleResource)
                .set(getHeaders())
                .expect(200);
            resp = await request.get('/4_0_0/Patient/').set(getHeaders()).expect(200);

            resp = await request.post('/4_0_0/Observation/1/$merge').send(observationResource).set(getHeaders());
            resp = await request.get('/4_0_0/Observation/').set(getHeaders()).expect(200);
            expect(resp.body.length).toBe(1);

            resp = await request.get('/4_0_0/CarePlan/').set(getHeaders()).expect(200);
            resp = await request
                // .get('/$graphql/?query=' + graphqlQueryText)
                // .set(getHeaders())
                .post('/4_0_0/$graphqlv2')
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

        test('Reference type doesn\'t match testcase works', async () => {
            const request = await createTestRequest();
            const graphqlQueryText = carePlanQuery.replace(/\\n/g, '');
            let resp = await request.get('/4_0_0/CarePlan').set(getHeaders()).expect(200);
            expect(resp.body.length).toBe(0);

            resp = await request
                .post('/4_0_0/CarePlan/$merge')
                .send(carePlanResource)
                .set(getHeaders())
                .expect(200);

            resp = await request.get('/4_0_0/CarePlan/').set(getHeaders()).expect(200);
            expect(resp.body.length).toBe(1);

            resp = await request
                .post('/4_0_0/$graphqlv2')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText
                })
                .set(getGraphQLHeaders())
                .expect(200);
            expect(resp).toHaveResponse(expectedCarePlan1);
        });

        test('Test query should be created in batches to fetch resources', async () => {
            const request = await createTestRequest();
            const graphqlQueryText = carePlan2Query.replace(/\\n/g, '');
            let resp = await request.get('/4_0_0/CarePlan').set(getHeaders()).expect(200);
            expect(resp.body.length).toBe(0);

            resp = await request
                .post('/4_0_0/CarePlan/1/$merge')
                .send(carePlan2Resource)
                .set(getHeaders())
                .expect(200);
            resp = await request.get('/4_0_0/Patient/').set(getHeaders()).expect(200);

            resp = await request.post('/4_0_0/Observation/1/$merge').send(observationResource).set(getHeaders());
            resp = await request.get('/4_0_0/Observation/').set(getHeaders()).expect(200);
            expect(resp.body.length).toBe(1);

            resp = await request.get('/4_0_0/CarePlan/').set(getHeaders()).expect(200);
            resp = await request
                .post('/4_0_0/$graphqlv2')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText
                })
                .set(getGraphQLHeaders())
                .expect(200);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedCarePlanBundle2Resource);

            // Now updating value of env variable to 2, to test resources are fetched from db in specified batch size
            const envValue = env.GRAPHQL_FETCH_RESOURCE_BATCH_SIZE;
            env.GRAPHQL_FETCH_RESOURCE_BATCH_SIZE = 2;

            resp = await request
                .post('/4_0_0/$graphqlv2')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText
                })
                .set(getGraphQLHeaders())
                .expect(200);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedCarePlanBundle3Resource);

            env.GRAPHQL_FETCH_RESOURCE_BATCH_SIZE = envValue;
        });
    });
});
