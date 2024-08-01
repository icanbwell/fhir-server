// provider file
const riskAssessment1Resource = require('./fixtures/riskAssessment/riskAssessment1.json');
const riskAssessment2Resource = require('./fixtures/riskAssessment/riskAssessment2.json');
const riskAssessment3Resource = require('./fixtures/riskAssessment/riskAssessment3.json');

// expected
const expectedRiskAssessment1 = require('./fixtures/expected/expected_risk_assessment_1.json');
const expectedRiskAssessment2 = require('./fixtures/expected/expected_risk_assessment_2.json');
const expectedRiskAssessment3 = require('./fixtures/expected/expected_risk_assessment_3.json');
const expectedRiskAssessment4 = require('./fixtures/expected/expected_risk_assessment_4.json');
const expectedRiskAssessment5 = require('./fixtures/expected/expected_risk_assessment_5.json');
const expectedRiskAssessment6 = require('./fixtures/expected/expected_risk_assessment_6.json');
const expectedRiskAssessment7 = require('./fixtures/expected/expected_risk_assessment_7.json');
const expectedRiskAssessment8 = require('./fixtures/expected/expected_risk_assessment_8.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Search by number tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('RiskAssessment Search By Number Tests', () => {
        test('search by number works', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
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

            // ACT & ASSERT
            // test for scientific notation with positive power
            resp = await request
                .get('/4_0_0/RiskAssessment?probability=1e2&_debug=true&_bundle=true')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedRiskAssessment1);

            // test for default search with range
            resp = await request
                .get('/4_0_0/RiskAssessment?probability=50&_debug=true&_bundle=true')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedRiskAssessment2);

            // test for default search ramge with decimal precision
            resp = await request
                .get('/4_0_0/RiskAssessment?probability=50.00&_debug=true&_bundle=true')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedRiskAssessment3);

            // test for ne prefix when range is considered
            resp = await request
                .get('/4_0_0/RiskAssessment?probability=ne50.00&_debug=true&_bundle=true')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedRiskAssessment4);

            // test for gt prefix when exact value is considered
            resp = await request
                .get('/4_0_0/RiskAssessment?probability=gt50&_debug=true&_bundle=true')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedRiskAssessment5);

            // test with incorrect prefix when search param is ignored
            resp = await request
                .get('/4_0_0/RiskAssessment?probability=lo50&_debug=true&_bundle=true')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedRiskAssessment6);

            // test for scientific notation with negative power
            resp = await request
                .get('/4_0_0/RiskAssessment?probability=5.40e-3&_debug=true&_bundle=true')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedRiskAssessment7);

            // test for ne prefix with scientific notation value
            resp = await request
                .get('/4_0_0/RiskAssessment?probability=ne5e3&_debug=true&_bundle=true')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedRiskAssessment8);
        });
    });
});
