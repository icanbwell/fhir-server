const questionnaireResponseBundle = require('./fixtures/questionnaire_responses.json');
const expectedQuestionnaireResponseBundle = require('./fixtures/expected_questionnaire_responses.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');
const {describe, beforeEach, afterEach, test, expect} = require('@jest/globals');
const {ConfigManager} = require('../../../utils/configManager');

class MockConfigManagerDefaultSortId extends ConfigManager {
    get defaultSortId () {
        return '_uuid';
    }

    get streamResponse () {
        return true;
    }

    get enableReturnBundle () {
        return true;
    }
}

describe('Questionnaire Response Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('QuestionnaireResponse Bundles', () => {
        test('QuestionnaireResponse can search by patient', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManagerDefaultSortId());
                return c;
            });
            let resp = await request
                .get('/4_0_0/QuestionnaireResponse')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/QuestionnaireResponse/1/$merge')
                .send(questionnaireResponseBundle)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/QuestionnaireResponse?id=140c02e4-e462-4be8-ab84-e0456ffe65eb')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedQuestionnaireResponseBundle);
        });
    });
});
