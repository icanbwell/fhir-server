const {describe, beforeEach, test, expect, jest} = require('@jest/globals');
const nock = require('nock');
const env = require('var');
const {getJwksByUrlAsync, getExternalJwksAsync, strategy} = require("../../strategies/jwt.bearer.strategy");
const {WellKnownConfigurationManager} = require("../../utils/wellKnownConfiguration/wellKnownConfigurationManager");

describe('JWT Bearer Strategy', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        nock.cleanAll();
    });

    test('should fetch JWKS from URL and cache it', async () => {
        const mockResponse = {keys: [{kid: '123', kty: 'RSA'}]};
        nock('https://example.com')
            .get('/jwks')
            .reply(200, mockResponse);

        const result = await getJwksByUrlAsync('https://example.com/jwks');
        expect(result).toEqual(mockResponse.keys);
    });

    test('should handle JWKS fetch failure gracefully', async () => {
        nock('https://example.com')
            .get('/jwks')
            .replyWithError('Network error');

        const result = await getJwksByUrlAsync('https://example.com/jwks');
        expect(result).toEqual({keys: []});
    });

    test('should fetch external JWKS from multiple URLs', async () => {
        env.EXTERNAL_AUTH_JWKS_URLS = 'https://example1.com/jwks,https://example2.com/jwks';
        nock('https://example1.com')
            .get('/jwks')
            .reply(200, {keys: [{kid: '123'}]});
        nock('https://example2.com')
            .get('/jwks')
            .reply(200, {keys: [{kid: '456'}]});

        const result = await getExternalJwksAsync();
        expect(result).toEqual([{kid: '123'}, {kid: '456'}]);
    });

    test('should return empty array if no external JWKS URLs are configured', async () => {
        env.EXTERNAL_AUTH_JWKS_URLS = '';
        const result = await getExternalJwksAsync();
        expect(result).toEqual([]);
    });

    test('should fetch user info from userInfo endpoint', async () => {
        const mockWellKnownConfig = {
            userinfoEndpoint: 'https://example.com/userinfo'
        };
        const mockUserInfo = {username: 'testUser', scope: 'read'};
        nock('https://example.com')
            .get('/.well-known/openid-configuration')
            .reply(200, mockWellKnownConfig);
        nock('https://example.com')
            .get('/userinfo')
            .reply(200, mockUserInfo);

        const wellKnownManager = new WellKnownConfigurationManager(
            {
                urlList: 'https://example.com/.well-known/openid-configuration'
            }
        );
        const config = await wellKnownManager.getWellKnownConfigurationForIssuer('https://example.com');
        expect(config).toEqual(mockWellKnownConfig);

        const userInfoResponse = await getExternalJwksAsync();
        expect(userInfoResponse).toEqual([]);
    });

    test('should redirect to login if no token is found and conditions are met', () => {
        const req = {
            useragent: {isDesktop: true},
            method: 'GET',
            originalUrl: '/test',
            headers: {host: 'localhost'}
        };
        const redirectMock = jest.fn();
        const strategyInstance = Object.create(strategy);
        strategyInstance.redirect = redirectMock;

        strategyInstance.authenticate(req, {});
        expect(redirectMock).toHaveBeenCalledWith(expect.stringContaining('/login?'));
    });

    test('should call parent authenticate method if token is found', () => {
        const req = {
            useragent: {isDesktop: true},
            method: 'GET',
            originalUrl: '/test',
            headers: {host: 'localhost'}
        };
        const tokenExtractorMock = jest.fn().mockReturnValue('token');
        strategy._jwtFromRequest = tokenExtractorMock;

        const authenticateSpy = jest.spyOn(strategy.__proto__, 'authenticate');
        strategy.authenticate(req, {});
        expect(authenticateSpy).toHaveBeenCalled();
    });
});
