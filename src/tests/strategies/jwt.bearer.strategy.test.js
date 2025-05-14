const {describe, beforeEach, test, expect, jest} = require('@jest/globals');
const nock = require('nock');
const env = require('var');
const {
    MyJwtStrategy
} = require("../../strategies/jwt.bearer.strategy");
const {WellKnownConfigurationManager} = require("../../utils/wellKnownConfiguration/wellKnownConfigurationManager");
const jwt = require("jsonwebtoken");
const crypto = require('crypto');
const AuthService = require("../../strategies/authService");

describe('JWT Bearer Strategy', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        nock.cleanAll();
    });

    test('should redirect to login if no token is found and conditions are met', () => {
        const req = {
            useragent: {isDesktop: true},
            method: 'GET',
            url: '/test',
            headers: {host: 'localhost'}
        };
        const redirectMock = jest.fn();
        const strategyInstance = new MyJwtStrategy({
            authService: new AuthService()
        });
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
