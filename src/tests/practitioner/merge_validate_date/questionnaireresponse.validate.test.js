const validResource = require('./fixtures/questionnaireresponse.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const { describe, beforeEach, afterEach, expect } = require('@jest/globals');

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
            console.log('------- response 1 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 1 ------------');

            resp = await request
                .post('/4_0_0/QuestionnaireResponse')
                .send(validResource)
                .set(getHeaders())
                .expect(201);
            let body = resp.body;
            console.log('------- response 1 ------------');
            console.log(JSON.stringify(body, null, 2));
            console.log('------- end response 1 ------------');
        });
    });
});
