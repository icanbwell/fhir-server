const {describe, beforeEach, test, expect, jest} = require('@jest/globals');
const nock = require('nock');
const passport = require('passport');
const {
    MyJwtStrategy
} = require("../../strategies/jwt.bearer.strategy");
const {WellKnownConfigurationManager} = require("../../utils/wellKnownConfiguration/wellKnownConfigurationManager");
const jwt = require("jsonwebtoken");
const crypto = require('crypto');
const {AuthService} = require("../../strategies/authService");
const {ConfigManager} = require("../../utils/configManager");
const {IncomingMessage} = require('http');
const {Socket} = require('net');

describe('JWT Bearer Strategy', () => {
    let jwtAccessToken;
    let publicKey1;
    let privateKey1;

    beforeEach(() => {
        jest.clearAllMocks();
        nock.cleanAll();

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

        publicKey1 = publicKey;
        privateKey1 = privateKey;

        const options = {
            algorithm: 'RS256',
            expiresIn: '1h'
        };

        const mockJwtPayload = {
            iss: 'https://example.com',
            client_id: 'testClientId'
        };
        // Sign the JWT using the proper private key
        jwtAccessToken = jwt.sign(mockJwtPayload, privateKey1, {
            algorithm: 'RS256',
            expiresIn: '1h',
            keyid: 'testKid' // Add the kid to match JWKS
        });
    });

    test('should return 401 if no token is found and conditions are met', () => {
        /** @type {import('http').IncomingMessage} */
        const req = new IncomingMessage(
            new Socket()
        );
        req.url = '/test';
        req.method = 'GET';
        req.headers = {host: 'localhost'};

        class MockConfigManager extends ConfigManager {
            /**
             * @returns {string[]}
             */
            get externalAuthWellKnownUrls() {
                return ['https://example.com/.well-known/openid-configuration'];
            }
        }

        const configManager = new MockConfigManager();
        const authService = new AuthService(
            {
                configManager: configManager,
                wellKnownConfigurationManager: new WellKnownConfigurationManager(
                    {
                        configManager
                    }
                )
            }
        );
        const strategy = new MyJwtStrategy({
            authService: authService,
            configManager: configManager
        });

        passport.use(strategy);

        passport.authenticate('jwt', {}, (err, user, info) => {
            expect(err).toBeNull();
            expect(user).toBeFalsy();
            expect(info).toBeTruthy();
        })(req);
    });

    test('should call parent authenticate method if token is found', () => {
        const req = {
            useragent: {isDesktop: true},
            method: 'GET',
            url: '/test',
            headers: {host: 'localhost'}
        };
        const tokenExtractorMock = jest.fn().mockReturnValue(jwtAccessToken);

        class MockConfigManager extends ConfigManager {
            /**
             * @returns {string[]}
             */
            get externalAuthWellKnownUrls() {
                return ['https://example.com/.well-known/openid-configuration'];
            }
        }

        const configManager = new MockConfigManager();
        const authService = new AuthService(
            {
                configManager: configManager,
                wellKnownConfigurationManager: new WellKnownConfigurationManager(
                    {
                        configManager
                    }
                )
            }
        );

        const strategy = new MyJwtStrategy({
            authService: authService,
            configManager: configManager
        });
        strategy._jwtFromRequest = tokenExtractorMock;

        passport.use(strategy);

        const authenticateSpy = jest.spyOn(strategy.__proto__, 'authenticate');
        passport.authenticate('jwt', {}, () => {
        })(req);
        expect(authenticateSpy).toHaveBeenCalled();
    });

    test('should fetch scopes via groups from userInfo endpoint when access token has no scopes', async () => {
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
                    x5c: [publicKey1.replace(/\n/g, '').replace(/-----BEGIN PUBLIC KEY-----/, '').replace(/-----END PUBLIC KEY-----/, '')]
                }
            ]
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

        const req = {
            headers: {authorization: `Bearer ${jwtAccessToken}`}
        };

        class MockConfigManager extends ConfigManager {
            /**
             * @returns {string}
             */
            get authJwksUrl() {
                return 'https://example.com/jwks';
            }
            /**
             * @returns {string[]}
             */
            get externalAuthJwksUrls() {
                return ['https://example.com/jwks'];
            }

            /**
             * @returns {string[]}
             */
            get externalAuthWellKnownUrls() {
                return ['https://example.com/.well-known/openid-configuration'];
            }
        }

        const configManager = new MockConfigManager();
        const strategy = new MyJwtStrategy({
            authService: new AuthService(
                {
                    configManager: configManager,
                    wellKnownConfigurationManager: new WellKnownConfigurationManager(
                        {
                            configManager: configManager
                        }
                    )
                }
            ),
            configManager: configManager
        });

        passport.use(strategy);

        return new Promise((resolve, reject) => {
            passport.authenticate('jwt', {}, (error, user, info) => {
                try {
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
            })(req);
        });
    });
});
