'use strict';

const { describe, test, expect, beforeEach, afterEach, jest: jestObj } = require('@jest/globals');

jestObj.mock('superagent', () => {
    const { jest: j } = require('@jest/globals');
    const mockGet = j.fn();
    return {
        get: mockGet
    };
});

jestObj.mock('../../../../operations/common/logging', () => {
    const { jest: j } = require('@jest/globals');
    return {
        logError: j.fn(),
        logInfo: j.fn()
    };
});

const superagent = require('superagent');
const { WellKnownConfigurationManager } = require('../../../../utils/wellKnownConfiguration/wellKnownConfigurationManager');

describe('WellKnownConfigurationManager', () => {
    let manager;

    const sampleConfig = {
        authorization_endpoint: 'https://auth.example.com/authorize',
        token_endpoint: 'https://auth.example.com/token',
        userinfo_endpoint: 'https://auth.example.com/userinfo',
        jwks_uri: 'https://auth.example.com/.well-known/jwks.json',
        issuer: 'https://auth.example.com',
        end_session_endpoint: 'https://auth.example.com/logout',
        scopes_supported: ['openid', 'profile'],
        response_types_supported: ['code'],
        token_endpoint_auth_methods_supported: ['client_secret_post'],
        revocation_endpoint: 'https://auth.example.com/revoke',
        introspection_endpoint: 'https://auth.example.com/introspect'
    };

    beforeEach(() => {
        // Reset static cache between tests
        WellKnownConfigurationManager.cache = undefined;
    });

    afterEach(() => {
        jestObj.clearAllMocks();
        WellKnownConfigurationManager.cache = undefined;
    });

    describe('constructor', () => {
        test('sets urls from configManager.externalAuthWellKnownUrls', () => {
            manager = new WellKnownConfigurationManager({
                configManager: { externalAuthWellKnownUrls: ['https://auth.example.com/.well-known/openid-configuration'] },
                cacheOptions: { max: 10, ttl: 1000 }
            });
            expect(manager.urls).toEqual(['https://auth.example.com/.well-known/openid-configuration']);
        });

        test('creates LRU cache when urls are provided', () => {
            manager = new WellKnownConfigurationManager({
                configManager: { externalAuthWellKnownUrls: ['https://auth.example.com/.well-known/openid-configuration'] },
                cacheOptions: { max: 50, ttl: 5000 }
            });
            expect(WellKnownConfigurationManager.cache).toBeDefined();
        });

        test('does not create cache when urls array is empty', () => {
            manager = new WellKnownConfigurationManager({
                configManager: { externalAuthWellKnownUrls: [] },
                cacheOptions: undefined
            });
            expect(WellKnownConfigurationManager.cache).toBeUndefined();
        });

        test('uses default cache options when cacheOptions not provided', () => {
            manager = new WellKnownConfigurationManager({
                configManager: { externalAuthWellKnownUrls: ['https://auth.example.com/.well-known'] },
                cacheOptions: undefined
            });
            expect(WellKnownConfigurationManager.cache).toBeDefined();
        });

        test('does not recreate cache if already exists', () => {
            new WellKnownConfigurationManager({
                configManager: { externalAuthWellKnownUrls: ['https://url1.com'] },
                cacheOptions: { max: 10, ttl: 1000 }
            });
            const firstCache = WellKnownConfigurationManager.cache;
            new WellKnownConfigurationManager({
                configManager: { externalAuthWellKnownUrls: ['https://url2.com'] },
                cacheOptions: { max: 20, ttl: 2000 }
            });
            expect(WellKnownConfigurationManager.cache).toBe(firstCache);
        });
    });

    describe('extractConfigurationDetails', () => {
        beforeEach(() => {
            manager = new WellKnownConfigurationManager({
                configManager: { externalAuthWellKnownUrls: ['https://auth.example.com/.well-known'] },
                cacheOptions: { max: 10, ttl: 1000 }
            });
        });

        test('extracts all expected fields from config', () => {
            const result = manager.extractConfigurationDetails(sampleConfig);
            expect(result.authorization_endpoint).toBe('https://auth.example.com/authorize');
            expect(result.token_endpoint).toBe('https://auth.example.com/token');
            expect(result.userinfo_endpoint).toBe('https://auth.example.com/userinfo');
            expect(result.jwks_uri).toBe('https://auth.example.com/.well-known/jwks.json');
            expect(result.issuer).toBe('https://auth.example.com');
            expect(result.end_session_endpoint).toBe('https://auth.example.com/logout');
            expect(result.scopes_supported).toEqual(['openid', 'profile']);
            expect(result.response_types_supported).toEqual(['code']);
            expect(result.token_endpoint_auth_methods_supported).toEqual(['client_secret_post']);
            expect(result.revocation_endpoint).toBe('https://auth.example.com/revoke');
            expect(result.introspection_endpoint).toBe('https://auth.example.com/introspect');
        });

        test('returns undefined for missing fields', () => {
            const partialConfig = { issuer: 'https://auth.example.com' };
            const result = manager.extractConfigurationDetails(partialConfig);
            expect(result.issuer).toBe('https://auth.example.com');
            expect(result.authorization_endpoint).toBeUndefined();
            expect(result.token_endpoint).toBeUndefined();
            expect(result.jwks_uri).toBeUndefined();
        });

        test('throws when config is null', () => {
            expect(() => manager.extractConfigurationDetails(null))
                .toThrow('Invalid configuration data');
        });

        test('throws when config is undefined', () => {
            expect(() => manager.extractConfigurationDetails(undefined))
                .toThrow('Invalid configuration data');
        });

        test('throws when config is not an object', () => {
            expect(() => manager.extractConfigurationDetails('string'))
                .toThrow('Invalid configuration data');
        });

        test('does not include extra fields from config', () => {
            const configWithExtra = { ...sampleConfig, extra_field: 'should not appear' };
            const result = manager.extractConfigurationDetails(configWithExtra);
            expect(result).not.toHaveProperty('extra_field');
        });
    });

    describe('fetchConfigurationAsync', () => {
        beforeEach(() => {
            manager = new WellKnownConfigurationManager({
                configManager: { externalAuthWellKnownUrls: ['https://auth.example.com/.well-known'] },
                cacheOptions: { max: 10, ttl: 1000 }
            });
        });

        test('fetches config from URL and returns data', async () => {
            const mockResponse = { text: JSON.stringify(sampleConfig) };
            superagent.get.mockReturnValue({
                set: jestObj.fn().mockResolvedValue(mockResponse)
            });

            const result = await manager.fetchConfigurationAsync('https://auth.example.com/.well-known');
            expect(result).toEqual(sampleConfig);
        });

        test('calls superagent.get with the URL', async () => {
            const mockResponse = { text: JSON.stringify(sampleConfig) };
            superagent.get.mockReturnValue({
                set: jestObj.fn().mockResolvedValue(mockResponse)
            });

            await manager.fetchConfigurationAsync('https://auth.example.com/.well-known');
            expect(superagent.get).toHaveBeenCalledWith('https://auth.example.com/.well-known');
        });

        test('sets Accept header to application/json', async () => {
            const mockSet = jestObj.fn().mockResolvedValue({ text: JSON.stringify(sampleConfig) });
            superagent.get.mockReturnValue({ set: mockSet });

            await manager.fetchConfigurationAsync('https://auth.example.com/.well-known');
            expect(mockSet).toHaveBeenCalledWith({ Accept: 'application/json' });
        });

        test('returns cached result on second call', async () => {
            const mockResponse = { text: JSON.stringify(sampleConfig) };
            superagent.get.mockReturnValue({
                set: jestObj.fn().mockResolvedValue(mockResponse)
            });

            await manager.fetchConfigurationAsync('https://auth.example.com/.well-known');
            const result = await manager.fetchConfigurationAsync('https://auth.example.com/.well-known');
            // superagent.get should only be called once since the second call uses cache
            expect(superagent.get).toHaveBeenCalledTimes(1);
        });

        test('throws when fetch fails', async () => {
            superagent.get.mockReturnValue({
                set: jestObj.fn().mockRejectedValue(new Error('Network error'))
            });

            await expect(manager.fetchConfigurationAsync('https://bad-url.com'))
                .rejects.toThrow('Failed to fetch configuration from https://bad-url.com: Network error');
        });

        test('throws when JSON parsing fails', async () => {
            superagent.get.mockReturnValue({
                set: jestObj.fn().mockResolvedValue({ text: 'not-json' })
            });

            await expect(manager.fetchConfigurationAsync('https://auth.example.com/.well-known'))
                .rejects.toThrow(/Failed to fetch configuration/);
        });
    });

    describe('fetchAllConfigurationsAsync', () => {
        test('fetches all configured URLs', async () => {
            manager = new WellKnownConfigurationManager({
                configManager: {
                    externalAuthWellKnownUrls: [
                        'https://auth1.example.com/.well-known',
                        'https://auth2.example.com/.well-known'
                    ]
                },
                cacheOptions: { max: 10, ttl: 1000 }
            });

            const mockResponse = { text: JSON.stringify(sampleConfig) };
            superagent.get.mockReturnValue({
                set: jestObj.fn().mockResolvedValue(mockResponse)
            });

            await manager.fetchAllConfigurationsAsync();
            expect(superagent.get).toHaveBeenCalledTimes(2);
        });

        test('continues fetching even if one URL fails', async () => {
            manager = new WellKnownConfigurationManager({
                configManager: {
                    externalAuthWellKnownUrls: [
                        'https://fail.example.com/.well-known',
                        'https://success.example.com/.well-known'
                    ]
                },
                cacheOptions: { max: 10, ttl: 1000 }
            });

            superagent.get.mockImplementation((url) => {
                if (url.includes('fail')) {
                    return { set: jestObj.fn().mockRejectedValue(new Error('fail')) };
                }
                return { set: jestObj.fn().mockResolvedValue({ text: JSON.stringify(sampleConfig) }) };
            });

            // Should not throw
            await manager.fetchAllConfigurationsAsync();
            expect(superagent.get).toHaveBeenCalledTimes(2);
        });
    });

    describe('getWellKnownConfigurationForIssuerAsync', () => {
        beforeEach(() => {
            manager = new WellKnownConfigurationManager({
                configManager: {
                    externalAuthWellKnownUrls: ['https://auth.example.com/.well-known']
                },
                cacheOptions: { max: 10, ttl: 1000 }
            });
        });

        test('returns config for matching issuer', async () => {
            const mockResponse = { text: JSON.stringify(sampleConfig) };
            superagent.get.mockReturnValue({
                set: jestObj.fn().mockResolvedValue(mockResponse)
            });

            const result = await manager.getWellKnownConfigurationForIssuerAsync('https://auth.example.com');
            expect(result.issuer).toBe('https://auth.example.com');
        });

        test('returns undefined when no matching issuer found', async () => {
            const mockResponse = { text: JSON.stringify(sampleConfig) };
            superagent.get.mockReturnValue({
                set: jestObj.fn().mockResolvedValue(mockResponse)
            });

            const result = await manager.getWellKnownConfigurationForIssuerAsync('https://other.example.com');
            expect(result).toBeUndefined();
        });
    });

    describe('getJwksUrlsAsync', () => {
        test('returns jwks_uri from all configs', async () => {
            manager = new WellKnownConfigurationManager({
                configManager: {
                    externalAuthWellKnownUrls: [
                        'https://auth1.example.com/.well-known',
                        'https://auth2.example.com/.well-known'
                    ]
                },
                cacheOptions: { max: 10, ttl: 1000 }
            });

            const config1 = { ...sampleConfig, jwks_uri: 'https://auth1.example.com/jwks' };
            const config2 = { ...sampleConfig, jwks_uri: 'https://auth2.example.com/jwks' };

            let callCount = 0;
            superagent.get.mockImplementation(() => {
                callCount++;
                const config = callCount <= 1 ? config1 : config2;
                return { set: jestObj.fn().mockResolvedValue({ text: JSON.stringify(config) }) };
            });

            const result = await manager.getJwksUrlsAsync();
            expect(result).toContain('https://auth1.example.com/jwks');
            expect(result).toContain('https://auth2.example.com/jwks');
        });

        test('skips configs without jwks_uri', async () => {
            manager = new WellKnownConfigurationManager({
                configManager: {
                    externalAuthWellKnownUrls: ['https://auth.example.com/.well-known']
                },
                cacheOptions: { max: 10, ttl: 1000 }
            });

            const configWithoutJwks = { ...sampleConfig, jwks_uri: undefined };
            superagent.get.mockReturnValue({
                set: jestObj.fn().mockResolvedValue({ text: JSON.stringify(configWithoutJwks) })
            });

            const result = await manager.getJwksUrlsAsync();
            expect(result).toEqual([]);
        });

        test('returns empty array when zero well-known URLs are configured', async () => {
            manager = new WellKnownConfigurationManager({
                configManager: { externalAuthWellKnownUrls: [] },
                cacheOptions: { max: 10, ttl: 1000 }
            });

            const result = await manager.getJwksUrlsAsync();
            expect(result).toEqual([]);
            expect(superagent.get).not.toHaveBeenCalled();
        });

        test('throws a transient/503 error when every configured URL fails (INC-322)', async () => {
            // A total outage across every configured well-known URL must NOT look the
            // same as "no well-known URLs configured" (previously both returned []),
            // otherwise AuthService.getExternalJwksAsync falls through to its unguarded
            // `return []` and the caller never learns this was a transient failure --
            // reintroducing the exact bug INC-322 was about, via the well-known fallback.
            manager = new WellKnownConfigurationManager({
                configManager: {
                    externalAuthWellKnownUrls: ['https://fail.example.com/.well-known']
                },
                cacheOptions: { max: 10, ttl: 1000 }
            });

            superagent.get.mockReturnValue({
                set: jestObj.fn().mockRejectedValue(new Error('Network error'))
            });

            await expect(manager.getJwksUrlsAsync()).rejects.toMatchObject({
                isTransient: true,
                statusCode: 503
            });
        });

        test('returns partial results when only some configured URLs fail', async () => {
            manager = new WellKnownConfigurationManager({
                configManager: {
                    externalAuthWellKnownUrls: [
                        'https://fail.example.com/.well-known',
                        'https://success.example.com/.well-known'
                    ]
                },
                cacheOptions: { max: 10, ttl: 1000 }
            });

            const config = { ...sampleConfig, jwks_uri: 'https://success.example.com/jwks' };
            superagent.get.mockImplementation((url) => {
                if (url.includes('fail')) {
                    return { set: jestObj.fn().mockRejectedValue(new Error('Network error')) };
                }
                return { set: jestObj.fn().mockResolvedValue({ text: JSON.stringify(config) }) };
            });

            const result = await manager.getJwksUrlsAsync();
            expect(result).toEqual(['https://success.example.com/jwks']);
        });
    });
});
