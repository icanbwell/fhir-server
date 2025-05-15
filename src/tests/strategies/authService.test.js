const {describe, beforeEach, test, expect, jest} = require('@jest/globals');
const nock = require('nock');
const env = require('var');
const {
    MyJwtStrategy
} = require("../../strategies/jwt.bearer.strategy");
const {WellKnownConfigurationManager} = require("../../utils/wellKnownConfiguration/wellKnownConfigurationManager");
const jwt = require("jsonwebtoken");
const crypto = require('crypto');
const {AuthService} = require("../../strategies/authService");
const {ConfigManager} = require("../../utils/configManager");

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

        class MockConfigManager extends ConfigManager {
            /**
             * @returns {string[]}
             */
            get externalAuthWellKnownUrls() {
                return [
                    'https://example.com/.well-known/openid-configuration'
                ];
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

        /**
         * @type {{keys:import('jwks-rsa').JSONWebKey[]}}
         */
        const result = await authService.getJwksByUrlAsync('https://example.com/jwks');
        expect(result).toEqual(mockResponse);
    });

    test('should handle JWKS fetch failure gracefully', async () => {
        nock('https://example.com')
            .get('/jwks')
            .replyWithError('Network error');

        class MockConfigManager extends ConfigManager {
            /**
             * @returns {string[]}
             */
            get externalAuthWellKnownUrls() {
                return [
                    'https://example.com/.well-known/openid-configuration'
                ];
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
        authService.clearJwksCache();

        const result = await authService.getJwksByUrlAsync('https://example.com/jwks');
        expect(result).toEqual({keys: []});
    });

    test('should fetch external JWKS from multiple URLs', async () => {
        nock('https://example1.com')
            .get('/jwks')
            .reply(200, {keys: [{kid: '123'}]});
        nock('https://example2.com')
            .get('/jwks')
            .reply(200, {keys: [{kid: '456'}]});

        class MockConfigManager extends ConfigManager {
            /**
             * @returns {string[]}
             */
            get externalAuthJwksUrls() {
                return ['https://example1.com/jwks', 'https://example2.com/jwks'];
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
        const result = await authService.getExternalJwksAsync();
        expect(result).toEqual([{kid: '123'}, {kid: '456'}]);
    });

    test('should return empty array if no external JWKS URLs are configured', async () => {
        class MockConfigManager extends ConfigManager {
            /**
             * @returns {string[]}
             */
            get externalAuthJwksUrls() {
                return [];
            }

            /**
             * @returns {string[]}
             */
            get externalAuthWellKnownUrls() {
                return [
                    'https://example.com/.well-known/openid-configuration'
                ];
            }
        }

        const configManager = new MockConfigManager();
        const authService = new AuthService(
            {
                configManager: configManager,
                wellKnownConfigurationManager: new WellKnownConfigurationManager(
                    {
                        configManager: configManager
                    }
                )
            }
        );
        const result = await authService.getExternalJwksAsync();
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

        class MockConfigManager extends ConfigManager {
            /**
             * @returns {string[]}
             */
            get externalAuthJwksUrls() {
                return ['https://example1.com/jwks,https://example2.com/jwks'];
            }

            /**
             * @returns {string[]}
             */
            get externalAuthWellKnownUrls() {
                return [
                    'https://example.com/.well-known/openid-configuration'
                ];
            }
        }

        const configManager = new MockConfigManager();

        const wellKnownManager = new WellKnownConfigurationManager(
            {
                configManager: configManager
            }
        );
        const config = await wellKnownManager.getWellKnownConfigurationForIssuerAsync('https://example.com');
        expect(config).toEqual(mockWellKnownConfig);

        const authService = new AuthService(
            {
                configManager: configManager,
                wellKnownConfigurationManager: wellKnownManager
            }
        );
        const userInfoResponse = await authService.getExternalJwksAsync();
        expect(userInfoResponse).toEqual([]);
    });

});
