const validPractitionerResource = require('./fixtures/valid_practitioner.json');
const validPractitionerNoSecurityCodeResource = require('./fixtures/valid_practitioner_no_security_code.json');
const invalidPractitionerResource = require('./fixtures/invalid_practitioner.json');

const expectedValidPractitionerResponse = require('./expected/valid_practitioner_response.json');
const expectedValidPractitionerNoSecurityCodeResponse = require('./expected/valid_practitioner_no_security_code_response.json');
const expectedInvalidPractitionerResponse = require('./expected/invalid_practitioner_response.json');

const {commonBeforeEach, commonAfterEach, getHeaders, createTestRequest} = require('../../common');
const {describe, beforeEach, afterEach, expect} = require('@jest/globals');

describe('Practitioner Update Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Practitioner Validate', () => {
        test('Valid resource', async () => {
            const request = await createTestRequest();
            let resp = await request
                .get('/4_0_0/Practitioner')
                .set(getHeaders())
                .expect(200);
            expect(resp.body.length).toBe(0);
            console.log('------- response 1 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 1 ------------');

            resp = await request
                .post('/4_0_0/Practitioner/$validate')
                .send(validPractitionerResource)
                .set(getHeaders())
                .expect(200);
            let body = resp.body;
            console.log('------- response 1 ------------');
            console.log(JSON.stringify(body, null, 2));
            console.log('------- end response 1 ------------');
            expect(body).toStrictEqual(expectedValidPractitionerResponse);

        });
        test('Valid resource but no security code', async () => {
            const request = await createTestRequest();
            let resp = await request
                .get('/4_0_0/Practitioner')
                .set(getHeaders())
                .expect(200);
            expect(resp.body.length).toBe(0);
            console.log('------- response 1 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 1 ------------');

            resp = await request
                .post('/4_0_0/Practitioner/$validate')
                .send(validPractitionerNoSecurityCodeResource)
                .set(getHeaders())
                .expect(200);
            let body = resp.body;
            console.log('------- response 1 ------------');
            console.log(JSON.stringify(body, null, 2));
            console.log('------- end response 1 ------------');
            expect(body).toStrictEqual(expectedValidPractitionerNoSecurityCodeResponse);
        });
        test('Invalid resource', async () => {
            const request = await createTestRequest();
            let resp = await request
                .get('/4_0_0/Practitioner')
                .set(getHeaders())
                .expect(200);
            expect(resp.body.length).toBe(0);
            console.log('------- response 1 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 1 ------------');

            resp = await request
                .post('/4_0_0/Practitioner/$validate')
                .send(invalidPractitionerResource)
                .set(getHeaders())
                .expect(200);
            let body = resp.body;
            console.log('------- response 2 ------------');
            console.log(JSON.stringify(body, null, 2));
            console.log('------- end response 2 ------------');
            expect(body).toStrictEqual(expectedInvalidPractitionerResponse);
        });
    });
});
