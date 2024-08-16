const allergyIntoleranceBundleResource = require('./fixtures/allergyIntolerance/allergy_intolerances.json');
const riskAssessment1Resource = require('./fixtures/riskAssessment/riskAssessment1.json');
const riskAssessment2Resource = require('./fixtures/riskAssessment/riskAssessment2.json');
const riskAssessment3Resource = require('./fixtures/riskAssessment/riskAssessment3.json');

const expectedAllergyIntolerance1 = require('./fixtures/expected/expected_allergy_intolerance1.json');
const expectedAllergyIntolerance2 = require('./fixtures/expected/expected_allergy_intolerance2.json');
const expectedAllergyIntolerance3 = require('./fixtures/expected/expected_allergy_intolerance3.json');
const expectedRiskAssessment1 = require('./fixtures/expected/expected_risk_assessment1.json');
const expectedRiskAssessment2 = require('./fixtures/expected/expected_risk_assessment2.json');
const expectedRiskAssessment3 = require('./fixtures/expected/expected_risk_assessment3.json');
const expectedRiskAssessment4 = require('./fixtures/expected/expected_risk_assessment4.json');
const expectedRiskAssessment5 = require('./fixtures/expected/expected_risk_assessment5.json');

const fs = require('fs');
const path = require('path');

const allergyIntoleranceQuery1 = fs.readFileSync(
    path.resolve(__dirname, './fixtures/allergy_intolerance_query1.graphql'),
    'utf8'
);
const allergyIntoleranceQuery2 = fs.readFileSync(
    path.resolve(__dirname, './fixtures/allergy_intolerance_query2.graphql'),
    'utf8'
);
const allergyIntoleranceQuery3 = fs.readFileSync(
    path.resolve(__dirname, './fixtures/allergy_intolerance_query3.graphql'),
    'utf8'
);
const allergyIntoleranceQuery4 = fs.readFileSync(
    path.resolve(__dirname, './fixtures/allergy_intolerance_query4.graphql'),
    'utf8'
);

const riskAssessmentQuery1 = fs.readFileSync(
  path.resolve(__dirname, './fixtures/risk_assessment_query1.graphql'),
  'utf8'
);
const riskAssessmentQuery2 = fs.readFileSync(
  path.resolve(__dirname, './fixtures/risk_assessment_query2.graphql'),
  'utf8'
);
const riskAssessmentQuery3 = fs.readFileSync(
  path.resolve(__dirname, './fixtures/risk_assessment_query3.graphql'),
  'utf8'
);
const riskAssessmentQuery4 = fs.readFileSync(
  path.resolve(__dirname, './fixtures/risk_assessment_query4.graphql'),
  'utf8'
);
const riskAssessmentQuery5 = fs.readFileSync(
  path.resolve(__dirname, './fixtures/risk_assessment_query5.graphql'),
  'utf8'
);
const riskAssessmentQuery6 = fs.readFileSync(
  path.resolve(__dirname, './fixtures/risk_assessment_query6.graphql'),
  'utf8'
);
const riskAssessmentQuery7 = fs.readFileSync(
  path.resolve(__dirname, './fixtures/risk_assessment_query7.graphql'),
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

describe('GraphQLV2 Range filters Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('GraphQLV2 Range filters tests', () => {
        test('Date filter tests on AllergyIntolerance', async () => {
            const request = await createTestRequest();
            const graphqlQueryText1 = allergyIntoleranceQuery1.replace(/\\n/g, '');
            const graphqlQueryText2 = allergyIntoleranceQuery2.replace(/\\n/g, '');
            const graphqlQueryText3 = allergyIntoleranceQuery3.replace(/\\n/g, '');
            const graphqlQueryText4 = allergyIntoleranceQuery4.replace(/\\n/g, '');

            let resp = await request.get('/4_0_0/AllergyIntolerance').set(getHeaders()).expect(200);
            expect(resp.body.length).toBe(0);

            resp = await request
                .post('/4_0_0/AllergyIntolerance/1/$merge')
                .send(allergyIntoleranceBundleResource)
                .set(getHeaders())
                .expect(200);

            resp = await request.get('/4_0_0/AllergyIntolerance/').set(getHeaders()).expect(200);

            resp = await request
                .post('/4_0_0/$graphqlv2')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText1
                })
                .set(getGraphQLHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedAllergyIntolerance1);

            resp = await request
                .post('/4_0_0/$graphqlv2')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText2
                })
                .set(getGraphQLHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedAllergyIntolerance1);

            resp = await request
                .post('/4_0_0/$graphqlv2')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText3
                })
                .set(getGraphQLHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedAllergyIntolerance2);

            resp = await request
                .post('/4_0_0/$graphqlv2')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText4
                })
                .set(getGraphQLHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedAllergyIntolerance3);
        });

        test('Number filter tests on RiskAssessment', async () => {
            const request = await createTestRequest();
            const graphqlQueryText1 = riskAssessmentQuery1.replace(/\\n/g, '');
            const graphqlQueryText2 = riskAssessmentQuery2.replace(/\\n/g, '');
            const graphqlQueryText3 = riskAssessmentQuery3.replace(/\\n/g, '');
            const graphqlQueryText4 = riskAssessmentQuery4.replace(/\\n/g, '');
            const graphqlQueryText5 = riskAssessmentQuery5.replace(/\\n/g, '');
            const graphqlQueryText6 = riskAssessmentQuery6.replace(/\\n/g, '');
            const graphqlQueryText7 = riskAssessmentQuery7.replace(/\\n/g, '');

            let resp = await request.get('/4_0_0/RiskAssessment').set(getHeaders()).expect(200);
            expect(resp.body.length).toBe(0);

            resp = await request
                    .post('/4_0_0/RiskAssessment/1/$merge?validate=true')
                    .send(riskAssessment1Resource)
                    .set(getHeaders());
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveMergeResponse({ created: true });

                resp = await request
                    .post('/4_0_0/RiskAssessment/1/$merge?validate=true')
                    .send(riskAssessment2Resource)
                    .set(getHeaders());
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveMergeResponse({ created: true });

                resp = await request
                    .post('/4_0_0/RiskAssessment/1/$merge?validate=true')
                    .send(riskAssessment3Resource)
                    .set(getHeaders());
                // noinspection JSUnresolvedFunction
                expect(resp).toHaveMergeResponse({ created: true });

            resp = await request.get('/4_0_0/RiskAssessment/').set(getHeaders()).expect(200);

            resp = await request
                .post('/4_0_0/$graphqlv2')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText1
                })
                .set(getGraphQLHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedRiskAssessment1);

            resp = await request
                .post('/4_0_0/$graphqlv2')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText2
                })
                .set(getGraphQLHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedRiskAssessment1);

            resp = await request
                .post('/4_0_0/$graphqlv2')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText3
                })
                .set(getGraphQLHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedRiskAssessment2);

            resp = await request
                .post('/4_0_0/$graphqlv2')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText4
                })
                .set(getGraphQLHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedRiskAssessment3);

            // Future possible prefixs (sa and eb)
            // resp = await request
            //     .post('/4_0_0/$graphqlv2')
            //     .send({
            //         operationName: null,
            //         variables: {},
            //         query: graphqlQueryText5
            //     })
            //     .set(getGraphQLHeaders())
            //     .expect(200);
            // // noinspection JSUnresolvedFunction
            // expect(resp).toHaveResponse(expectedRiskAssessment4);
            //
            // resp = await request
            //     .post('/4_0_0/$graphqlv2')
            //     .send({
            //         operationName: null,
            //         variables: {},
            //         query: graphqlQueryText6
            //     })
            //     .set(getGraphQLHeaders())
            //     .expect(200);
            // // noinspection JSUnresolvedFunction
            // expect(resp).toHaveResponse(expectedRiskAssessment4);

            resp = await request
                .post('/4_0_0/$graphqlv2')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText7
                })
                .set(getGraphQLHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedRiskAssessment5);
        });
    });
});
