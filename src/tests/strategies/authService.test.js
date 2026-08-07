const {describe, beforeEach, afterAll, test, expect, jest} = require('@jest/globals');
const nock = require('nock');
const {WellKnownConfigurationManager} = require("../../utils/wellKnownConfiguration/wellKnownConfigurationManager");
const {AuthService} = require("../../strategies/authService");
const {ConfigManager} = require("../../utils/configManager");
describe('JWT Bearer Strategy', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        nock.cleanAll();
    });

    afterAll(() => {
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
        // Use .reply(500) instead of .replyWithError(): nock v14's MSW-backed
        // playback path for replyWithError leaks a stale "Network error" event
        // listener onto MockHttpSocket that recurses into the next test's
        // request, crashing it with a deep MockHttpSocket emit chain.
        // .reply(500) exercises the same production catch branch (now throws a
        // transient/503-marked error instead of returning {keys: []} -- see
        // INC-322) without triggering that code path. .times(4) covers the
        // initial attempt + 3 superagent retries (EXTERNAL_REQUEST_RETRY_COUNT).
        nock('https://example.com')
            .get('/jwks')
            .times(4)
            .reply(500, 'Network error');

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
        authService.clearAuthCache();

        // CORRECT behavior (INC-322): a JWKS fetch failure must not be swallowed into
        // {keys: []} -- that's indistinguishable downstream from "this endpoint
        // legitimately has no keys" (permanent) vs. "we couldn't reach it" (transient).
        // It must propagate as a transient/503-marked error instead.
        await expect(
            authService.getJwksByUrlAsync('https://example.com/jwks')
        ).rejects.toMatchObject({
            isTransient: true,
            statusCode: 503
        });
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

            // externalAuthWellKnownUrls intentionally left at the base class's default
            // ([]): this test is about NOTHING being configured at all. A non-empty
            // well-known URL here exercises a different scenario -- "every configured
            // well-known URL failed to resolve" -- which getJwksUrlsAsync now throws a
            // transient/503 error for by design (INC-322), not the [] this test expects.
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
                // Intentionally empty: this test exercises the well-known-URL fallback
                // path in getExternalJwksAsync (below), not direct JWKS URL fetching. A
                // non-empty value here would need its own nock interceptor now that
                // JWKS fetch failures propagate as errors instead of being silently
                // swallowed to {keys: []} (INC-322).
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
        // mockWellKnownConfig has no jwks_uri, so the well-known fallback resolves to
        // no JWKS URLs at all and no further network calls are made.
        const userInfoResponse = await authService.getExternalJwksAsync();
        expect(userInfoResponse).toEqual([]);
    });

});
