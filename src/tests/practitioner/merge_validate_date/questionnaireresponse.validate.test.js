const validResource = require('./fixtures/questionnaireresponse.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const { describe, beforeEach, afterEach, expect, test } = require('@jest/globals');
const { logInfo } = require('../../../operations/common/logging');

describe('Practitioner Update Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Practitioner Validate', () => {
        test('POST Valid resource', async () => {
            const request = await createTestRequest();
            let resp = await request
                .get('/4_0_0/QuestionnaireResponse')
                .set(getHeaders())
                .expect(200);

            expect(resp.body.length).toBe(0);
            logInfo('------- response 1 ------------');
            logInfo('', {'resp': resp.body});
            logInfo('------- end response 1 ------------');

            resp = await request
                .post('/4_0_0/QuestionnaireResponse')
                .send(validResource)
                .set(getHeaders())
                .expect(201);
            let body = resp.body;
            logInfo('------- response 1 ------------');
            logInfo('', {body});
            logInfo('------- end response 1 ------------');
        });
    });
});
