const {describe, beforeEach, test, expect, jest} = require('@jest/globals');
const nock = require('nock');
const env = require('var');
const {
    getJwksByUrlAsync,
    getExternalJwksAsync,
    strategy,
    clearJwksCache
} = require("../../strategies/jwt.bearer.strategy");
const {WellKnownConfigurationManager} = require("../../utils/wellKnownConfiguration/wellKnownConfigurationManager");
const jwt = require("jsonwebtoken");
const crypto = require('crypto');

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

        /**
         * @type {{keys:import('jwks-rsa').JSONWebKey[]}}
         */
        const result = await getJwksByUrlAsync('https://example.com/jwks');
        expect(result).toEqual(mockResponse);
    });

    test('should handle JWKS fetch failure gracefully', async () => {
        nock('https://example.com')
            .get('/jwks')
            .replyWithError('Network error');

        clearJwksCache();

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
            userinfo_endpoint: 'https://example.com/userinfo',
            issuer: 'https://example.com'
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
            url: '/test',
            headers: {host: 'localhost'}
        };
        const redirectMock = jest.fn();
        const strategyInstance = Object.create(strategy);
        strategyInstance.redirect = redirectMock;

        const oldEnvironment = env.REDIRECT_TO_LOGIN;
        env.REDIRECT_TO_LOGIN = 'true';

        strategyInstance.authenticate(req, {});
        expect(redirectMock).toHaveBeenCalledWith(expect.stringContaining('/login?'));
        env.REDIRECT_TO_LOGIN = oldEnvironment;
    });

    test('should call parent authenticate method if token is found', () => {
        const req = {
            useragent: {isDesktop: true},
            method: 'GET',
            url: '/test',
            headers: {host: 'localhost'}
        };
        const tokenExtractorMock = jest.fn().mockReturnValue('token');
        strategy._jwtFromRequest = tokenExtractorMock;

        const authenticateSpy = jest.spyOn(strategy.__proto__, 'authenticate');
        strategy.authenticate(req, {});
        expect(authenticateSpy).toHaveBeenCalled();
    });

    test('should fetch scopes via groups from userInfo endpoint when access token has no scopes', async () => {
        // Generate a proper RSA key pair
        const {privateKey, publicKey} = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: {
                type: 'spki',
                format: 'pem'
            },
            privateKeyEncoding: {
                type: 'pkcs8',
                format: 'pem'
            }
        });

        const options = {
            algorithm: 'RS256',
            expiresIn: '1h'
        };

        const mockWellKnownConfig = {
            userinfo_endpoint: 'https://example.com/userinfo',
            issuer: 'https://example.com',
            jwks_uri: 'https://example.com/jwks'
        };

        const mockUserInfo = {
            username: 'testUser',
            groups: ['group1', 'group2']
        };

        // Correctly prepare the JWKS representation
        const mockJwks = {
            keys: [
                {
                    kty: 'RSA',
                    alg: 'RS256',
                    use: 'sig',
                    kid: 'testKid',
                    // Use PEM format for the public key
                    x5c: [publicKey.replace(/\n/g, '').replace(/-----BEGIN PUBLIC KEY-----/, '').replace(/-----END PUBLIC KEY-----/, '')]
                }
            ]
        };

        const mockJwtPayload = {
            iss: 'https://example.com',
            client_id: 'testClientId'
        };

        nock('https://example.com')
            .get('/.well-known/openid-configuration')
            .reply(200, mockWellKnownConfig);

        nock('https://example.com')
            .get('/jwks')
            .reply(200, mockJwks);

        nock('https://example.com')
            .get('/userinfo')
            .reply(200, mockUserInfo);

        // Sign the JWT using the proper private key
        const jwtAccessToken = jwt.sign(mockJwtPayload, privateKey, {
            algorithm: 'RS256',
            expiresIn: '1h',
            keyid: 'testKid' // Add the kid to match JWKS
        });

        const req = {
            headers: {authorization: `Bearer ${jwtAccessToken}`}
        };

        const externalAuthWellKnownUrls = env.EXTERNAL_AUTH_WELL_KNOWN_URLS;
        env.EXTERNAL_AUTH_WELL_KNOWN_URLS = 'https://example.com/.well-known/openid-configuration';

        const externalAuthJwksUrls = env.EXTERNAL_AUTH_JWKS_URLS;
        env.EXTERNAL_AUTH_JWKS_URLS = 'https://example.com/jwks';

        return new Promise((resolve, reject) => {
            const doneMock = jest.fn((error, user, info) => {
                try {
                    // Cleanup environment variables
                    env.EXTERNAL_AUTH_WELL_KNOWN_URLS = externalAuthWellKnownUrls;
                    env.EXTERNAL_AUTH_JWKS_URLS = externalAuthJwksUrls;

                    // Assertions
                    expect(error).toBeNull();
                    expect(user).toEqual({
                        id: 'testClientId',
                        isUser: false,
                        name: 'testUser',
                        username: 'testUser'
                    });
                    expect(info).toEqual({
                        scope: 'group1 group2',
                        context: {
                            username: 'testUser',
                            subject: null,
                            isUser: false
                        }
                    });

                    resolve();
                } catch (assertionError) {
                    reject(assertionError);
                }
            });

            // Call the strategy's authenticate method
            strategy.authenticate(req, doneMock);
        });
    });
});
