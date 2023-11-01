// provider file
const patient1Resource = require('./fixtures/patient/patient1.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getHtmlHeaders,
    createTestRequest, getTestContainer, mockHttpContext,
} = require('../../common');
const {describe, beforeEach, afterEach, expect, test} = require('@jest/globals');
const {logInfo} = require('../../../operations/common/logging');

describe('History UI Tests', () => {
    let requestId;
    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Patient History Search By Id Tests', () => {
        test('history by single id works', async () => {
            const request = await createTestRequest();
            let resp = await request.get('/4_0_0/Patient').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Patient/00100000000/$merge?validate=true')
                .send(patient1Resource)
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            /**
             * @type {SimpleContainer}
             */
            const container = getTestContainer();
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.executeAsync({requestId: requestId});
            await postRequestProcessor.waitTillDoneAsync({requestId: requestId});

            // now merge the modified patient.  There should be an additional history record created
            patient1Resource.birthDate = '2015-01-01';
            resp = await request
                .post('/4_0_0/Patient/00100000000/$merge?validate=true')
                .send(patient1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({updated: true});

            await postRequestProcessor.executeAsync({requestId: requestId});
            await postRequestProcessor.waitTillDoneAsync({requestId: requestId});

            resp = await request
                .get('/4_0_0/Patient/00100000000/_history')
                .set(getHtmlHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusOk();

            logInfo('------- response Patient sorted ------------', {});
            logInfo('', {resp});
            logInfo('------- end response sort ------------', {});
            expect(resp.type).toStrictEqual('text/html');
            expect(resp.body).toStrictEqual({});
            expect(resp.text).not.toBeNull();
            const text = resp.text.replace('\\"', '"').replaceAll('\n', '').replaceAll('&#34;', '"');
            logInfo('------- response html ------------');
            logInfo(text);
            logInfo('------- end response html ------------');
            expect(text).toMatch(new RegExp('^<!DOCTYPE html>?'));
            expect(text).toMatch(new RegExp('<b>Version:</b> 2'));
            expect(text).toMatch(new RegExp('family=PATIENT1'));
            expect(text).toMatch(new RegExp('\\"diagnostics\\": \\"{\\\\\\"op\\\\\\":\\\\\\"replace\\\\\\",\\\\\\"path\\\\\\":\\\\\\"/birthDate\\\\\\",\\\\\\"value\\\\\\":\\\\\\"2015-01-01\\\\\\"}\\"'));
        });
    });
});
