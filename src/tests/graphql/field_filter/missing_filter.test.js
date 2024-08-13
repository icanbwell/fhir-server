const appointmentBundleResource = require('./fixtures/appointment/appointment.json');
const conditionBundleResource = require('./fixtures/condition/condition.json');
const riskAssessment1Resource = require('./fixtures/riskAssessment/riskAssessment1.json');
const riskAssessment2Resource = require('./fixtures/riskAssessment/riskAssessment2.json');
const riskAssessment3Resource = require('./fixtures/riskAssessment/riskAssessment3.json');

const expectedAppointment1 = require('./fixtures/expected/expected_appointment1.json');
const expectedAppointment2 = require('./fixtures/expected/expected_appointment2.json');
const expectedAppointment3 = require('./fixtures/expected/expected_appointment3.json');
const expectedAppointment4 = require('./fixtures/expected/expected_appointment4.json');
const expectedAppointment5 = require('./fixtures/expected/expected_appointment5.json');
const expectedAppointment6 = require('./fixtures/expected/expected_appointment6.json');
const expectedAppointment7 = require('./fixtures/expected/expected_appointment7.json');
const expectedAppointment8 = require('./fixtures/expected/expected_appointment8.json');
const expectedCondition1 = require('./fixtures/expected/expected_condition1.json');
const expectedCondition2 = require('./fixtures/expected/expected_condition2.json');
const expectedRiskAssessment1 = require('./fixtures/expected/expected_risk_assessment1.json');
const expectedRiskAssessment2 = require('./fixtures/expected/expected_risk_assessment4.json');

const fs = require('fs');
const path = require('path');

const appointmentQuery1 = fs.readFileSync(
    path.resolve(__dirname, './fixtures/appointment_query_1.graphql'),
    'utf8'
);
const appointmentQuery2 = fs.readFileSync(
    path.resolve(__dirname, './fixtures/appointment_query_2.graphql'),
    'utf8'
);
const appointmentQuery3 = fs.readFileSync(
    path.resolve(__dirname, './fixtures/appointment_query_3.graphql'),
    'utf8'
);
const appointmentQuery4 = fs.readFileSync(
    path.resolve(__dirname, './fixtures/appointment_query_4.graphql'),
    'utf8'
);
const appointmentQuery5 = fs.readFileSync(
    path.resolve(__dirname, './fixtures/appointment_query_5.graphql'),
    'utf8'
);
const appointmentQuery6 = fs.readFileSync(
    path.resolve(__dirname, './fixtures/appointment_query_6.graphql'),
    'utf8'
);
const appointmentQuery7 = fs.readFileSync(
    path.resolve(__dirname, './fixtures/appointment_query_7.graphql'),
    'utf8'
);
const appointmentQuery8 = fs.readFileSync(
    path.resolve(__dirname, './fixtures/appointment_query_8.graphql'),
    'utf8'
);
const appointmentQuery9 = fs.readFileSync(
    path.resolve(__dirname, './fixtures/appointment_query_9.graphql'),
    'utf8'
);
const appointmentQuery10 = fs.readFileSync(
    path.resolve(__dirname, './fixtures/appointment_query_10.graphql'),
    'utf8'
);
const appointmentQuery11 = fs.readFileSync(
    path.resolve(__dirname, './fixtures/appointment_query_11.graphql'),
    'utf8'
);
const appointmentQuery12 = fs.readFileSync(
    path.resolve(__dirname, './fixtures/appointment_query_12.graphql'),
    'utf8'
);

const conditionQuery1 = fs.readFileSync(
    path.resolve(__dirname, './fixtures/condition_query_1.graphql'),
    'utf8'
);
const conditionQuery2 = fs.readFileSync(
    path.resolve(__dirname, './fixtures/condition_query_2.graphql'),
    'utf8'
);
const conditionQuery3 = fs.readFileSync(
    path.resolve(__dirname, './fixtures/condition_query_3.graphql'),
    'utf8'
);

const riskAssessmentQuery1 = fs.readFileSync(
    path.resolve(__dirname, './fixtures/risk_assessment_query1.graphql'),
    'utf8'
);
const riskAssessmentQuery2 = fs.readFileSync(
    path.resolve(__dirname, './fixtures/risk_assessment_query5.graphql'),
    'utf8'
);
const riskAssessmentQuery3 = fs.readFileSync(
    path.resolve(__dirname, './fixtures/risk_assessment_query6.graphql'),
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

    describe('GraphQLV2 missing filters tests', () => {
        test('Test case for SearchString', async () => {
            const request = await createTestRequest();
            const graphqlQueryText1 = appointmentQuery1.replace(/\\n/g, '');
            const graphqlQueryText2 = appointmentQuery2.replace(/\\n/g, '');
            const graphqlQueryText3 = appointmentQuery3.replace(/\\n/g, '');

            let resp = await request.get('/4_0_0/Appointment').set(getHeaders()).expect(200);
            expect(resp.body.length).toBe(0);

            resp = await request
                .post('/4_0_0/Appointment/1/$merge')
                .send(appointmentBundleResource)
                .set(getHeaders())
                .expect(200);

            resp = await request.get('/4_0_0/Appointment/').set(getHeaders()).expect(200);

            resp = await request
                .post('/$graphql')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText1
                })
                .set(getGraphQLHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedAppointment1);

            resp = await request
                .post('/$graphql')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText2
                })
                .set(getGraphQLHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedAppointment1);

            resp = await request
                .post('/$graphql')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText3
                })
                .set(getGraphQLHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedAppointment2);
        });

        test('Test case for SearchToken', async () => {
            const request = await createTestRequest();
            const graphqlQueryText1 = appointmentQuery4.replace(/\\n/g, '');
            const graphqlQueryText2 = appointmentQuery5.replace(/\\n/g, '');
            const graphqlQueryText3 = appointmentQuery6.replace(/\\n/g, '');

            let resp = await request.get('/4_0_0/Appointment').set(getHeaders()).expect(200);
            expect(resp.body.length).toBe(0);

            resp = await request
                .post('/4_0_0/Appointment/1/$merge')
                .send(appointmentBundleResource)
                .set(getHeaders())
                .expect(200);

            resp = await request.get('/4_0_0/Appointment/').set(getHeaders()).expect(200);

            resp = await request
                .post('/$graphql')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText1
                })
                .set(getGraphQLHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedAppointment3);

            resp = await request
                .post('/$graphql')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText2
                })
                .set(getGraphQLHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedAppointment3);

            resp = await request
                .post('/$graphql')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText3
                })
                .set(getGraphQLHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedAppointment4);
        });

        test('Test case for SearchReference', async () => {
            const request = await createTestRequest();
            const graphqlQueryText1 = appointmentQuery7.replace(/\\n/g, '');
            const graphqlQueryText2 = appointmentQuery8.replace(/\\n/g, '');
            const graphqlQueryText3 = appointmentQuery9.replace(/\\n/g, '');

            let resp = await request.get('/4_0_0/Appointment').set(getHeaders()).expect(200);
            expect(resp.body.length).toBe(0);

            resp = await request
                .post('/4_0_0/Appointment/1/$merge')
                .send(appointmentBundleResource)
                .set(getHeaders())
                .expect(200);

            resp = await request.get('/4_0_0/Appointment/').set(getHeaders()).expect(200);

            resp = await request
                .post('/$graphql')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText1
                })
                .set(getGraphQLHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedAppointment5);

            resp = await request
                .post('/$graphql')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText2
                })
                .set(getGraphQLHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedAppointment5);

            resp = await request
                .post('/$graphql')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText3
                })
                .set(getGraphQLHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedAppointment6);
        });

        test('Test case for SearchQuantity', async () => {
            const request = await createTestRequest();
            const graphqlQueryText1 = conditionQuery1.replace(/\\n/g, '');
            const graphqlQueryText2 = conditionQuery2.replace(/\\n/g, '');
            const graphqlQueryText3 = conditionQuery3.replace(/\\n/g, '');

            let resp = await request.get('/4_0_0/Condition').set(getHeaders()).expect(200);
            expect(resp.body.length).toBe(0);

            resp = await request
                .post('/4_0_0/Condition/1/$merge')
                .send(conditionBundleResource)
                .set(getHeaders())
                .expect(200);

            resp = await request.get('/4_0_0/Condition/').set(getHeaders()).expect(200);

            resp = await request
                .post('/$graphql')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText1
                })
                .set(getGraphQLHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedCondition1);

            resp = await request
                .post('/$graphql')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText2
                })
                .set(getGraphQLHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedCondition1);

            resp = await request
                .post('/$graphql')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText3
                })
                .set(getGraphQLHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedCondition2);
        });

        test('Test case for SearchDate', async () => {
            const request = await createTestRequest();
            const graphqlQueryText1 = appointmentQuery10.replace(/\\n/g, '');
            const graphqlQueryText2 = appointmentQuery11.replace(/\\n/g, '');
            const graphqlQueryText3 = appointmentQuery12.replace(/\\n/g, '');

            let resp = await request.get('/4_0_0/Appointment').set(getHeaders()).expect(200);
            expect(resp.body.length).toBe(0);

            resp = await request
                .post('/4_0_0/Appointment/1/$merge')
                .send(appointmentBundleResource)
                .set(getHeaders())
                .expect(200);

            resp = await request.get('/4_0_0/Appointment/').set(getHeaders()).expect(200);

            resp = await request
                .post('/$graphql')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText1
                })
                .set(getGraphQLHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedAppointment7);

            resp = await request
                .post('/$graphql')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText2
                })
                .set(getGraphQLHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedAppointment7);

            resp = await request
                .post('/$graphql')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText3
                })
                .set(getGraphQLHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedAppointment8);
        });

        test('Test case for SearchNumber', async () => {
            const request = await createTestRequest();
            const graphqlQueryText1 = riskAssessmentQuery1.replace(/\\n/g, '');
            const graphqlQueryText2 = riskAssessmentQuery2.replace(/\\n/g, '');
            const graphqlQueryText3 = riskAssessmentQuery3.replace(/\\n/g, '');

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
                .post('/$graphql')
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
                .post('/$graphql')
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
                .post('/$graphql')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText3
                })
                .set(getGraphQLHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedRiskAssessment2);
        });
    });
});
