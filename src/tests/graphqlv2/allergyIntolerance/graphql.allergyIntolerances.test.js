const allergyIntoleranceBundleResource = require('./fixtures/allergy_intolerances.json');
const expectedAllergyIntoleranceBundleResource = require('./fixtures/expected_allergy_intolerances.json');

const patientBundleResource = require('./fixtures/patients.json');

const fs = require('fs');
const path = require('path');

const allergyIntoleranceQuery = fs.readFileSync(
    path.resolve(__dirname, './fixtures/query.graphql'),
    'utf8'
);

const allergyIntoleranceQuery2 = fs.readFileSync(
    path.resolve(__dirname, './fixtures/query2.graphql'),
    'utf8'
);

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getGraphQLHeaders,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('GraphQLV2 AllergyIntolerance Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('GraphQLV2 AllergyIntolerance', () => {
        test('GraphQLV2 AllergyIntolerance properly', async () => {
            const request = await createTestRequest();
            const graphqlQueryText = allergyIntoleranceQuery.replace(/\\n/g, '');
            let resp = await request.get('/4_0_0/AllergyIntolerance').set(getHeaders()).expect(200);
            expect(resp.body.length).toBe(0);

            resp = await request
                .post('/4_0_0/Patient/1/$merge')
                .send(patientBundleResource)
                .set(getHeaders())
                .expect(200);

            resp = await request
                .post('/4_0_0/AllergyIntolerance/1/$merge')
                .send(allergyIntoleranceBundleResource)
                .set(getHeaders())
                .expect(200);

            resp = await request.get('/4_0_0/Patient/').set(getHeaders()).expect(200);
            resp = await request.get('/4_0_0/AllergyIntolerance/').set(getHeaders()).expect(200);

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
            expect(resp).toHaveResponse(expectedAllergyIntoleranceBundleResource);
        });
        test('GraphQLV2 AllergyIntolerance verification status', async () => {
            const request = await createTestRequest();
            const graphqlQueryText = allergyIntoleranceQuery2.replace(/\\n/g, '');
            let resp = await request.get('/4_0_0/AllergyIntolerance').set(getHeaders()).expect(200);
            expect(resp.body.length).toBe(0);

            resp = await request
                .post('/4_0_0/Patient/1/$merge')
                .send(patientBundleResource)
                .set(getHeaders())
                .expect(200);

            resp = await request
                .post('/4_0_0/AllergyIntolerance/1/$merge')
                .send(allergyIntoleranceBundleResource)
                .set(getHeaders())
                .expect(200);

            resp = await request.get('/4_0_0/Patient/').set(getHeaders()).expect(200);
            resp = await request.get('/4_0_0/AllergyIntolerance/').set(getHeaders()).expect(200);

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
            expect(resp).toHaveResponse(expectedAllergyIntoleranceBundleResource);
        });
    });
});
