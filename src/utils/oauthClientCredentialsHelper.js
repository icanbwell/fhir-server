const superagent = require('superagent');
const { assertTypeEquals, assertIsValid } = require('./assertType');
const { ConfigManager } = require('./configManager');
const { logInfo } = require('../operations/common/logging');
const { EXTERNAL_REQUEST_RETRY_COUNT } = require('../constants');

const TOKEN_EXPIRY_BUFFER_SECONDS = 60;

class OAuthClientCredentialsHelper {
    /**
     * @param {ConfigManager} configManager
     */
    constructor ({ configManager }) {
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        /** @type {string|null} */
        this._cachedToken = null;
        /** @type {number|null} */
        this._tokenExpiresAt = null;
    }

    /**
     * Gets a valid access token, fetching a new one if needed.
     * Throws if OAuth config is not set.
     * @returns {Promise<string>}
     */
    async getAccessTokenAsync () {
        assertIsValid(this.configManager.personMatchingServiceClientId,
            'PERSON_MATCHING_SERVICE_CLIENT_ID environment variable is not set');
        assertIsValid(this.configManager.personMatchingServiceClientSecret,
            'PERSON_MATCHING_SERVICE_CLIENT_SECRET environment variable is not set');
        assertIsValid(this.configManager.personMatchingServiceTokenUrl,
            'PERSON_MATCHING_SERVICE_TOKEN_URL environment variable is not set');

        if (this._cachedToken && this._tokenExpiresAt && Date.now() < this._tokenExpiresAt) {
            return this._cachedToken;
        }

        return this._fetchNewTokenAsync();
    }

    /**
     * @private
     * @returns {Promise<string>}
     */
    async _fetchNewTokenAsync () {
        const tokenUrl = this.configManager.personMatchingServiceTokenUrl;
        const clientId = this.configManager.personMatchingServiceClientId;
        const clientSecret = this.configManager.personMatchingServiceClientSecret;

        logInfo('Fetching new OAuth token for person matching service', { tokenUrl });

        const res = await superagent
            .post(tokenUrl)
            .type('form')
            .send({
                grant_type: 'client_credentials',
                client_id: clientId,
                client_secret: clientSecret
            })
            .retry(EXTERNAL_REQUEST_RETRY_COUNT)
            .timeout(this.configManager.requestTimeoutMs);

        const { access_token, expires_in } = res.body;

        assertIsValid(access_token, 'OAuth token response did not contain access_token');

        this._cachedToken = access_token;
        const expiresInMs = (expires_in || 3600) * 1000;
        this._tokenExpiresAt = Date.now() + expiresInMs - (TOKEN_EXPIRY_BUFFER_SECONDS * 1000);

        logInfo('Successfully obtained OAuth token for person matching service', {
            expiresInSeconds: expires_in
        });

        return this._cachedToken;
    }
}

module.exports = {
    OAuthClientCredentialsHelper
};
