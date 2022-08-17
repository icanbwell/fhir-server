const questionnaireResponseBundle = require('./fixtures/questionnaire_responses.json');
const expectedQuestionnaireResponseBundle = require('./fixtures/expected_questionnaire_responses.json');
const expectedQuestionnaireResponseBundle2 = require('./fixtures/expected_questionnaire_responses_2.json');

const {commonBeforeEach, commonAfterEach, getHeaders, createTestRequest} = require('../../common');
const {describe, beforeEach, afterEach, expect} = require('@jest/globals');
const {assertStatusCode} = require('../../fhirAsserts');

describe('Questionnaire Response Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('QuestionnaireResponse Bundles', () => {
        test('QuestionnaireResponse can search by null', async () => {
            const request = await createTestRequest();
            let resp = await request
                .get('/4_0_0/QuestionnaireResponse')
                .set(getHeaders())
                .expect(200);
            expect(resp.body.length).toBe(0);
            console.log('------- response 1 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 1 ------------');

            resp = await request
                .post('/4_0_0/QuestionnaireResponse/1/$merge')
                .send(questionnaireResponseBundle)
                .set(getHeaders())
                .expect(200);
            console.log('------- response 2 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 2  ------------');

            resp = await request
                .get('/4_0_0/QuestionnaireResponse?patient:missing=true')
                .set(getHeaders())
                .expect(200);
            // clear out the lastUpdated column since that changes
            let body = resp.body;
            console.log('------- response 5 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 5  ------------');
            expect(body.length).toBe(1);
            body.forEach(element => {
                delete element['meta']['lastUpdated'];
            });
            let expected = expectedQuestionnaireResponseBundle;
            expected.forEach(element => {
                if ('meta' in element) {
                    delete element['meta']['lastUpdated'];
                }
                // element['meta'] = {'versionId': '1'};
                if ('$schema' in element) {
                    delete element['$schema'];
                }
            });
            expect(body).toStrictEqual(expected);

            resp = await request
                .get('/4_0_0/QuestionnaireResponse?patient:missing=false')
                .set(getHeaders())
                .expect(assertStatusCode(200));
            // clear out the lastUpdated column since that changes
            body = resp.body;
            console.log('------- response 5 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 5  ------------');
            expect(body.length).toBe(1);
            body.forEach(element => {
                delete element['meta']['lastUpdated'];
            });
            expected = expectedQuestionnaireResponseBundle2;
            expected.forEach(element => {
                if ('meta' in element) {
                    delete element['meta']['lastUpdated'];
                }
                // element['meta'] = {'versionId': '1'};
                if ('$schema' in element) {
                    delete element['$schema'];
                }
            });
            expect(body).toStrictEqual(expected);
        });
    });
});
