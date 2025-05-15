const nock = require('nock');
const {LRUCache} = require('lru-cache');
const {beforeEach, describe, test, expect} = require("@jest/globals");
const {WellKnownConfigurationManager} = require("../../../utils/wellKnownConfiguration/wellKnownConfigurationManager");
const {ConfigManager} = require("../../../utils/configManager");

describe('WellKnownConfigurationManager', () => {
    const urlList = 'https://example.com/.well-known/openid-configuration,https://example2.com/.well-known/openid-configuration';
    const cacheOptions = {max: 50, ttl: 3600000};

    beforeEach(() => {
        nock.cleanAll();
        WellKnownConfigurationManager.cache = undefined; // Reset static cache
    });

    test('should initialize with URLs and cache', () => {
        class MockConfigManager extends ConfigManager {
            /**
             * @returns {string[]}
             */
            get externalAuthWellKnownUrls() {
                return ['https://example.com/.well-known/openid-configuration', 'https://example2.com/.well-known/openid-configuration'];
            }
        }

        const configManager = new MockConfigManager();
        const manager = new WellKnownConfigurationManager(
            {configManager, cacheOptions});
        expect(manager.urls).toEqual([
            'https://example.com/.well-known/openid-configuration',
            'https://example2.com/.well-known/openid-configuration'
        ]);
        expect(WellKnownConfigurationManager.cache).toBeInstanceOf(LRUCache);
    });

    test('should fetch and cache configuration from a URL', async () => {
        const mockResponse = {
            authorization_endpoint: 'https://example.com/auth',
            token_endpoint: 'https://example.com/token',
            userinfo_endpoint: 'https://example.com/userinfo',
            jwks_uri: 'https://example.com/jwks',
            issuer: 'https://example.com'
        };

        nock('https://example.com')
            .get('/.well-known/openid-configuration')
            .reply(200, mockResponse);

        class MockConfigManager extends ConfigManager {
            /**
             * @returns {string[]}
             */
            get externalAuthWellKnownUrls() {
                return ['https://example.com/.well-known/openid-configuration', 'https://example2.com/.well-known/openid-configuration'];
            }
        }

        const configManager = new MockConfigManager();
        const manager = new WellKnownConfigurationManager(
            {configManager, cacheOptions});
        const config = await manager.fetchConfigurationAsync('https://example.com/.well-known/openid-configuration');

        expect(config).toEqual(mockResponse);
        expect(WellKnownConfigurationManager.cache.has('https://example.com/.well-known/openid-configuration')).toBe(true);
    });

    test('should return cached configuration if available', async () => {
        const mockResponse = {
            authorization_endpoint: 'https://example.com/auth',
            token_endpoint: 'https://example.com/token',
            userinfo_endpoint: 'https://example.com/userinfo',
            jwks_uri: 'https://example.com/jwks',
            issuer: 'https://example.com'
        };

        class MockConfigManager extends ConfigManager {
            /**
             * @returns {string[]}
             */
            get externalAuthWellKnownUrls() {
                return ['https://example.com/.well-known/openid-configuration', 'https://example2.com/.well-known/openid-configuration'];
            }
        }

        const configManager = new MockConfigManager();
        const manager = new WellKnownConfigurationManager(
            {configManager, cacheOptions});
        WellKnownConfigurationManager.cache.set('https://example.com/.well-known/openid-configuration', mockResponse);

        const config = await manager.fetchConfigurationAsync('https://example.com/.well-known/openid-configuration');
        expect(config).toEqual(mockResponse);
    });

    test('should fetch all configurations from URLs', async () => {
        const mockResponse1 = {
            authorization_endpoint: 'https://example.com/auth',
            token_endpoint: 'https://example.com/token',
            userinfo_endpoint: 'https://example.com/userinfo',
            jwks_uri: 'https://example.com/jwks',
            issuer: 'https://example.com'
        };

        const mockResponse2 = {
            authorization_endpoint: 'https://example2.com/auth',
            token_endpoint: 'https://example2.com/token',
            userinfo_endpoint: 'https://example2.com/userinfo',
            jwks_uri: 'https://example2.com/jwks',
            issuer: 'https://example2.com'
        };

        nock('https://example.com')
            .get('/.well-known/openid-configuration')
            .reply(200, mockResponse1);

        nock('https://example2.com')
            .get('/.well-known/openid-configuration')
            .reply(200, mockResponse2);

        class MockConfigManager extends ConfigManager {
            /**
             * @returns {string[]}
             */
            get externalAuthWellKnownUrls() {
                return ['https://example.com/.well-known/openid-configuration', 'https://example2.com/.well-known/openid-configuration'];
            }
        }

        const configManager = new MockConfigManager();
        const manager = new WellKnownConfigurationManager(
            {configManager, cacheOptions});
        await manager.fetchAllConfigurationsAsync();

        expect(WellKnownConfigurationManager.cache.has('https://example.com/.well-known/openid-configuration')).toBe(true);
        expect(WellKnownConfigurationManager.cache.has('https://example2.com/.well-known/openid-configuration')).toBe(true);
    });

    test('should fetch well-known configuration for a specific issuer', async () => {
        const mockResponse = {
            authorization_endpoint: 'https://example.com/auth',
            token_endpoint: 'https://example.com/token',
            userinfo_endpoint: 'https://example.com/userinfo',
            jwks_uri: 'https://example.com/jwks',
            issuer: 'https://example.com'
        };

        nock('https://example.com')
            .get('/.well-known/openid-configuration')
            .reply(200, mockResponse);

        class MockConfigManager extends ConfigManager {
            /**
             * @returns {string[]}
             */
            get externalAuthWellKnownUrls() {
                return ['https://example.com/.well-known/openid-configuration', 'https://example2.com/.well-known/openid-configuration'];
            }
        }

        const configManager = new MockConfigManager();
        const manager = new WellKnownConfigurationManager(
            {configManager, cacheOptions});
        const config = await manager.getWellKnownConfigurationForIssuerAsync('https://example.com');

        expect(config).toEqual(mockResponse);
    });

    test('should return undefined if issuer is not found', async () => {
        const mockResponse = {
            authorization_endpoint: 'https://example.com/auth',
            token_endpoint: 'https://example.com/token',
            userinfo_endpoint: 'https://example.com/userinfo',
            jwks_uri: 'https://example.com/jwks',
            issuer: 'https://example.com'
        };

        nock('https://example.com')
            .get('/.well-known/openid-configuration')
            .reply(200, mockResponse);

        class MockConfigManager extends ConfigManager {
            /**
             * @returns {string[]}
             */
            get externalAuthWellKnownUrls() {
                return ['https://example.com/.well-known/openid-configuration', 'https://example2.com/.well-known/openid-configuration'];
            }
        }

        const configManager = new MockConfigManager();
        const manager = new WellKnownConfigurationManager(
            {configManager, cacheOptions});
        const config = await manager.getWellKnownConfigurationForIssuerAsync('https://unknown.com');

        expect(config).toBeUndefined();
    });
});
