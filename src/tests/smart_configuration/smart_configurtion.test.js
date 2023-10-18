const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../common');
const { describe, beforeEach, afterEach, test } = require('@jest/globals');
const nock = require('nock');

// expected
const timoeutError = require('./expected/expected_504.json');

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
            authorization_endpoint: '/oauth2/authorize',
        };
        nock('https://cognito-idp.us-east-1.amazonaws.com/us-east-1_yV7wvD4xD')
            .get('/.well-known/openid-configuration')
            .delay(100)
            .reply(200, mockedResponse)
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
            .reply(200, mockedResponse);

        let resp = await request.get('/.well-known/smart-configuration').set(getHeaders());
        expect(resp).toHaveMergeResponse(mockedResponse);

        // now should throw timeout error
        resp = await request.get('/.well-known/smart-configuration').set(getHeaders());
        // expect timeout error
        expect(resp).toHaveResponse(timoeutError);
    });
});
