const questionnaireResponseBundle = require('./fixtures/questionnaire_responses.json');
const expectedQuestionnaireResponseBundle = require('./fixtures/expected_questionnaire_responses.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const {describe, beforeEach, afterEach, expect} = require('@jest/globals');
const {expectMergeResponse, expectResourceCount} = require('../../fhirAsserts');

describe('Questionnaire Response Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('QuestionnaireResponse Bundles', () => {
        test('QuestionnaireResponse can search by questionnaire', async () => {
            const request = await createTestRequest();
            let resp = await request
                .get('/4_0_0/QuestionnaireResponse')
                .set(getHeaders());
            expectResourceCount(resp, 0);

            resp = await request
                .post('/4_0_0/QuestionnaireResponse/1/$merge')
                .send(questionnaireResponseBundle)
                .set(getHeaders());
            expectMergeResponse(resp, {created: true});

            resp = await request
                .get(
                    '/4_0_0/QuestionnaireResponse?questionnaire=https://protocol-service.icanbwell.com/Questionnaire/medstar-squeeze|4.0.0'
                )
                .set(getHeaders());
            expect(resp).toHaveResponse(expectedQuestionnaireResponseBundle);
        });
    });
});
