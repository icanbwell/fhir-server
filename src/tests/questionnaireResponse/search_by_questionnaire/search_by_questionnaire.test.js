const questionnaireResponseBundle = require('./fixtures/questionnaire_responses.json');
const expectedQuestionnaireResponseBundle = require('./fixtures/expected_questionnaire_responses.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const { describe, beforeEach, afterEach } = require('@jest/globals');
const { assertResourceCount, assertMerge, assertResponse } = require('../../fhirAsserts');

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
            await request
                .get('/4_0_0/QuestionnaireResponse')
                .set(getHeaders())
                .expect(assertResourceCount(0));

            await request
                .post('/4_0_0/QuestionnaireResponse/1/$merge')
                .send(questionnaireResponseBundle)
                .set(getHeaders())
                .expect(assertMerge({ created: true }));

            await request
                .get(
                    '/4_0_0/QuestionnaireResponse?questionnaire=https://protocol-service.icanbwell.com/Questionnaire/medstar-squeeze|4.0.0'
                )
                .set(getHeaders())
                .expect(assertResponse({ expected: expectedQuestionnaireResponseBundle }));
        });
    });
});
