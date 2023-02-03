// provider file
const patient1Resource = require('./fixtures/patient/patient1.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getHtmlHeaders,
    createTestRequest, getHtmlHeadersWithForm,
} = require('../../common');
const {describe, beforeEach, afterEach, expect, test} = require('@jest/globals');
const {logInfo} = require('../../../operations/common/logging');

describe('Patient UI Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Patient Search By Id Tests', () => {
        test('search by single id works', async () => {
            const request = await createTestRequest();
            let resp = await request.get('/4_0_0/Patient').set(getHeaders()).expect(200);

            expect(resp.body.length).toBe(0);
            logInfo('------- response 1 ------------');
            logInfo('', {'resp': resp.body});
            logInfo('------- end response 1 ------------');

            resp = await request
                .post('/4_0_0/Patient/1679033641/$merge?validate=true')
                .send(patient1Resource)
                .set(getHeaders())
                .expect(200);

            logInfo('------- response patient1Resource ------------');
            logInfo('', {'resp': resp.body});
            logInfo('------- end response  ------------');
            expect(resp.body['created']).toBe(true);

            resp = await request.get('/4_0_0/Patient').set(getHeaders()).expect(200);

            logInfo('------- response 3 ------------');
            logInfo('', {'resp': resp.body});
            logInfo('------- end response 3 ------------');

            resp = await request
                .get('/4_0_0/Patient/00100000000')
                .set(getHtmlHeaders())
                .expect(200);

            logInfo('------- response Patient sorted ------------');
            logInfo('', {resp});
            logInfo('------- end response sort ------------');
            expect(resp.type).toStrictEqual('text/html');
            expect(resp.body).toStrictEqual({});
            expect(resp.text).not.toBeNull();
            expect(resp.text).toMatch(new RegExp('^<!DOCTYPE html>?'));

            resp = await request
                .post('/4_0_0/Patient/_search')
                .set(getHtmlHeadersWithForm());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusOk();

            logInfo('------- response Patient sorted ------------');
            logInfo('', {resp});
            logInfo('------- end response sort ------------');
            expect(resp.type).toStrictEqual('text/html');
            expect(resp.body).toStrictEqual({});
            expect(resp.text).not.toBeNull();
            expect(resp.text).toMatch(new RegExp('^<!DOCTYPE html>?'));

            resp = await request
                .get('/4_0_0/Patient/_search')
                .set(getHtmlHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusOk();

            logInfo('------- response Patient sorted ------------');
            logInfo('', {resp});
            logInfo('------- end response sort ------------');
            expect(resp.type).toStrictEqual('text/html');
            expect(resp.body).toStrictEqual({});
            expect(resp.text).not.toBeNull();
            expect(resp.text).toMatch(new RegExp('^<!DOCTYPE html>?'));
        });
    });
});
