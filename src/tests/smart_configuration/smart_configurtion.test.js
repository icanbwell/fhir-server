const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const nock = require('nock');

// expected
const timeoutError = require('./expected/expected_504.json');

describe('Smart Configuration', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('should fetch configuration from smart config and also handle errors', async () => {
        const request = await createTestRequest();
        const mockedResponse = {
            authorization_endpoint: '/oauth2/authorize'
        };
        nock('https://cognito-idp.us-east-1.amazonaws.com/us-east-1_yV7wvD4xD')
            // retry 3 times
            .get('/.well-known/openid-configuration')
            .delay(6000)
            .reply(200, mockedResponse)
            .get('/.well-known/openid-configuration')
            .delay(6000)
            .reply(200, mockedResponse)
            .get('/.well-known/openid-configuration')
            .delay(6000)
            .reply(200, mockedResponse)
            .get('/.well-known/openid-configuration')
            .delay(6000)
            .reply(200, mockedResponse)
            .get('/.well-known/openid-configuration')
            .delay(100)
            .reply(200, mockedResponse)
            .get('/.well-known/openid-configuration')
            .delay(6000)
            .reply(200, mockedResponse);

        // should throw timeout error
        let resp = await request.get('/.well-known/smart-configuration').set(getHeaders());
        // expect timeout error
        expect(resp).toHaveResponse(timeoutError);

        // should return correct response
        resp = await request.get('/.well-known/smart-configuration').set(getHeaders());
        expect(resp).toHaveMergeResponse(mockedResponse);

        // should not throw timeout error due to cache
        resp = await request.get('/.well-known/smart-configuration').set(getHeaders());
        expect(resp).toHaveMergeResponse(mockedResponse);
    });
});
