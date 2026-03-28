const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');
const nock = require('nock');
const { OAuthClientCredentialsHelper } = require('../../../utils/oauthClientCredentialsHelper');
const { ConfigManager } = require('../../../utils/configManager');

class MockConfigManager extends ConfigManager {
    constructor ({ clientId, clientSecret, tokenUrl } = {}) {
        super();
        this._clientId = clientId;
        this._clientSecret = clientSecret;
        this._tokenUrl = tokenUrl;
    }

    get personMatchingServiceClientId () {
        return this._clientId;
    }

    get personMatchingServiceClientSecret () {
        return this._clientSecret;
    }

    get personMatchingServiceTokenUrl () {
        return this._tokenUrl;
    }

    get requestTimeoutMs () {
        return { response: 30000, deadline: 60000 };
    }
}

const TOKEN_URL = 'http://auth.example.com';
const TOKEN_PATH = '/oauth/token';

describe('OAuthClientCredentialsHelper', () => {
    beforeEach(() => {
        nock.cleanAll();
    });

    describe('getAccessTokenAsync', () => {
        test('throws when client id is missing', async () => {
            const helper = new OAuthClientCredentialsHelper({
                configManager: new MockConfigManager({
                    clientSecret: 'secret',
                    tokenUrl: `${TOKEN_URL}${TOKEN_PATH}`
                })
            });

            await expect(helper.getAccessTokenAsync()).rejects.toThrow(
                'PERSON_MATCHING_SERVICE_CLIENT_ID environment variable is not set'
            );
        });

        test('throws when client secret is missing', async () => {
            const helper = new OAuthClientCredentialsHelper({
                configManager: new MockConfigManager({
                    clientId: 'my-client',
                    tokenUrl: `${TOKEN_URL}${TOKEN_PATH}`
                })
            });

            await expect(helper.getAccessTokenAsync()).rejects.toThrow(
                'PERSON_MATCHING_SERVICE_CLIENT_SECRET environment variable is not set'
            );
        });

        test('throws when token url is missing', async () => {
            const helper = new OAuthClientCredentialsHelper({
                configManager: new MockConfigManager({
                    clientId: 'my-client',
                    clientSecret: 'secret'
                })
            });

            await expect(helper.getAccessTokenAsync()).rejects.toThrow(
                'PERSON_MATCHING_SERVICE_TOKEN_URL environment variable is not set'
            );
        });

        test('fetches token successfully', async () => {
            nock(TOKEN_URL)
                .post(TOKEN_PATH, 'grant_type=client_credentials&client_id=my-client&client_secret=secret')
                .reply(200, {
                    access_token: 'test-token-123',
                    expires_in: 3600,
                    token_type: 'Bearer'
                });

            const helper = new OAuthClientCredentialsHelper({
                configManager: new MockConfigManager({
                    clientId: 'my-client',
                    clientSecret: 'secret',
                    tokenUrl: `${TOKEN_URL}${TOKEN_PATH}`
                })
            });

            const token = await helper.getAccessTokenAsync();
            expect(token).toBe('test-token-123');
        });

        test('throws when response has no access_token', async () => {
            nock(TOKEN_URL)
                .post(TOKEN_PATH)
                .reply(200, { token_type: 'Bearer' });

            const helper = new OAuthClientCredentialsHelper({
                configManager: new MockConfigManager({
                    clientId: 'my-client',
                    clientSecret: 'secret',
                    tokenUrl: `${TOKEN_URL}${TOKEN_PATH}`
                })
            });

            await expect(helper.getAccessTokenAsync()).rejects.toThrow(
                'OAuth token response did not contain access_token'
            );
        });

        test('caches token on second call', async () => {
            nock(TOKEN_URL)
                .post(TOKEN_PATH)
                .once()
                .reply(200, {
                    access_token: 'cached-token',
                    expires_in: 3600
                });

            const helper = new OAuthClientCredentialsHelper({
                configManager: new MockConfigManager({
                    clientId: 'my-client',
                    clientSecret: 'secret',
                    tokenUrl: `${TOKEN_URL}${TOKEN_PATH}`
                })
            });

            const token1 = await helper.getAccessTokenAsync();
            const token2 = await helper.getAccessTokenAsync();

            expect(token1).toBe('cached-token');
            expect(token2).toBe('cached-token');
            expect(nock.isDone()).toBe(true);
        });

        test('refreshes token when expired', async () => {
            nock(TOKEN_URL)
                .post(TOKEN_PATH)
                .reply(200, {
                    access_token: 'first-token',
                    expires_in: 3600
                });

            const helper = new OAuthClientCredentialsHelper({
                configManager: new MockConfigManager({
                    clientId: 'my-client',
                    clientSecret: 'secret',
                    tokenUrl: `${TOKEN_URL}${TOKEN_PATH}`
                })
            });

            const token1 = await helper.getAccessTokenAsync();
            expect(token1).toBe('first-token');

            // Simulate token expiry
            helper._tokenExpiresAt = Date.now() - 1000;

            nock(TOKEN_URL)
                .post(TOKEN_PATH)
                .reply(200, {
                    access_token: 'refreshed-token',
                    expires_in: 3600
                });

            const token2 = await helper.getAccessTokenAsync();
            expect(token2).toBe('refreshed-token');
        });

        test('defaults expires_in to 3600 when not provided', async () => {
            nock(TOKEN_URL)
                .post(TOKEN_PATH)
                .reply(200, {
                    access_token: 'no-expiry-token'
                });

            const helper = new OAuthClientCredentialsHelper({
                configManager: new MockConfigManager({
                    clientId: 'my-client',
                    clientSecret: 'secret',
                    tokenUrl: `${TOKEN_URL}${TOKEN_PATH}`
                })
            });

            const token = await helper.getAccessTokenAsync();
            expect(token).toBe('no-expiry-token');

            // Token should be cached with default 3600s - 60s buffer
            const expectedMinExpiry = Date.now() + (3600 - 60 - 1) * 1000;
            expect(helper._tokenExpiresAt).toBeGreaterThan(expectedMinExpiry);
        });

        test('treats token within 60s buffer as expired', async () => {
            nock(TOKEN_URL)
                .post(TOKEN_PATH)
                .reply(200, {
                    access_token: 'short-lived-token',
                    expires_in: 30
                });

            const helper = new OAuthClientCredentialsHelper({
                configManager: new MockConfigManager({
                    clientId: 'my-client',
                    clientSecret: 'secret',
                    tokenUrl: `${TOKEN_URL}${TOKEN_PATH}`
                })
            });

            await helper.getAccessTokenAsync();

            // expires_in=30 minus 60s buffer means token is already "expired"
            expect(helper._tokenExpiresAt).toBeLessThan(Date.now());

            // Next call should fetch a new token
            nock(TOKEN_URL)
                .post(TOKEN_PATH)
                .reply(200, {
                    access_token: 'new-token',
                    expires_in: 3600
                });

            const token = await helper.getAccessTokenAsync();
            expect(token).toBe('new-token');
        });
    });
});
