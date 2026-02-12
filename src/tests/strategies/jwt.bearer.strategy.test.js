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
const {publicKey, privateKey} = require('../mocks/keys');
const {createJwksKeyAsync} = require("../mocks/jwks");

describe('JWT Bearer Strategy', () => {
    let jwtAccessToken;

    beforeEach(() => {
        jest.clearAllMocks();
        nock.cleanAll();

        const mockJwtPayload = {
            iss: 'https://example.com',
            client_id: 'testClientId'
        };
        // Sign the JWT using the proper private key
        jwtAccessToken = jwt.sign(mockJwtPayload, privateKey, {
            algorithm: 'RS256',
            expiresIn: '1h',
            keyid: '123' // Add the kid to match JWKS
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
            groups: ['group1', 'group2', 'dev/fhir/access/*.*'],
            client_id: 'testClientId'
        };

        // Correctly prepare the JWKS representation
        const mockJwks = {
            keys: [
                await createJwksKeyAsync(
                    {
                        pub: publicKey,
                        kid: '123'
                    }
                )
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

            /**
             * @returns {string[]}
             */
            get authRemoveScopePrefixes() {
                return [
                    'dev/fhir/'
                ]
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
                        scope: 'group1 group2 access/*.*',
                        context: {
                            username: 'testUser'
                        }
                    });

                    resolve();
                } catch (assertionError) {
                    reject(assertionError);
                }
            })(req);
        });
    });

    test('should set username to clientFhirPersonId and subject to sub for patient-scoped tokens', async () => {
        const mockJwks = {
            keys: [
                await createJwksKeyAsync(
                    {
                        pub: publicKey,
                        kid: '123'
                    }
                )
            ]
        };

        nock('https://example.com')
            .get('/jwks')
            .reply(200, mockJwks);

        const patientScopedPayload = {
            iss: 'https://example.com',
            client_id: 'testClientId',
            scope: 'patient/*.* user/*.* access/*.*',
            username: 'imran',
            sub: 'jwt-subject',
            clientFhirPersonId: 'clientFhirPerson',
            clientFhirPatientId: 'clientFhirPatient',
            bwellFhirPersonId: 'bwellFhirPerson',
            bwellFhirPatientId: 'bwellFhirPatient',
            managingOrganization: 'org1'
        };

        const patientScopedToken = jwt.sign(patientScopedPayload, privateKey, {
            algorithm: 'RS256',
            expiresIn: '1h',
            keyid: '123'
        });

        const req = {
            headers: {authorization: `Bearer ${patientScopedToken}`}
        };

        class MockConfigManager extends ConfigManager {
            get authJwksUrl() {
                return 'https://example.com/jwks';
            }

            get externalAuthJwksUrls() {
                return ['https://example.com/jwks'];
            }

            get externalAuthWellKnownUrls() {
                return [];
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
                    expect(error).toBeNull();
                    expect(user).toStrictEqual({
                        id: 'testClientId',
                        isUser: true,
                        name: 'clientFhirPerson',
                        username: 'clientFhirPerson'
                    });
                    expect(info).toStrictEqual({
                        scope: 'patient/*.* user/*.* access/*.*',
                        context: {
                            isUser: true,
                            username: 'clientFhirPerson',
                            subject: 'jwt-subject',
                            personIdFromJwtToken: 'clientFhirPerson',
                            masterPersonIdFromJwtToken: 'bwellFhirPerson',
                            managingOrganizationId: 'org1'
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
