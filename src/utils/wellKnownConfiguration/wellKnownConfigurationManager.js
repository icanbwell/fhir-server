const superagent = require('superagent');
const {LRUCache} = require('lru-cache');
const {logError} = require("../../operations/common/logging");

/**
 * @typedef {Object} WellKnownConfigurationInfo
 * @property {string} authorization_endpoint - The authorization endpoint URL.
 * @property {string} token_endpoint - The token endpoint URL.
 * @property {string} userinfo_endpoint - The userinfo endpoint URL.
 * @property {string} jwks_uri - The JWKS URI.
 * @property {string} issuer - The issuer URL.
 */

class WellKnownConfigurationManager {
    /**
     * Cache for configuration data.
     * @type {LRUCache<{}, {}, any>}
     */
    static cache;

    /**
     * @param {ConfigManager} configManager - The configuration manager instance.
     * @param {{max:number, ttl:number} | undefined} [cacheOptions] - Options for the LRU cache.
     */
    constructor({configManager, cacheOptions}) {
        /**
         * @type {string[]}
         */
        this.urls = configManager.externalAuthWellKnownUrls;
        if (this.urls.length > 0) {
            if (WellKnownConfigurationManager.cache === undefined) {
                WellKnownConfigurationManager.cache = new LRUCache({
                    max: cacheOptions ? cacheOptions.max : 100, // Maximum number of items in the cache
                    ttl: cacheOptions ? cacheOptions.ttl : 60 * 60 * 1000 // Time-to-live is one hour
                });
            }
        }

    }

    /**
     * Extracts specific fields from the configuration data.
     * @param {Object} config - The configuration data fetched from the endpoint.
     * @returns {WellKnownConfigurationInfo} - An object containing the extracted fields.
     */
    extractConfigurationDetails(config) {
        if (!config || typeof config !== 'object') {
            throw new Error('Invalid configuration data');
        }

        return {
            authorization_endpoint: config.authorization_endpoint,
            token_endpoint: config.token_endpoint,
            userinfo_endpoint: config.userinfo_endpoint,
            jwks_uri: config.jwks_uri,
            issuer: config.issuer
        };
    }

    /**
     * Fetches configuration data from a given URL and caches it.
     * @param {string} url - The URL to fetch data from.
     * @returns {Promise<WellKnownConfigurationInfo>} - The fetched configuration data.
     */
    async fetchConfiguration(url) {
        if (WellKnownConfigurationManager.cache.has(url)) {
            return WellKnownConfigurationManager.cache.get(url);
        }

        try {
            const response = await superagent.get(url).set({Accept: 'application/json'});
            const data = JSON.parse(response.text);
            /**
             * @type {WellKnownConfigurationInfo}
             */
            const extractedData = this.extractConfigurationDetails(data);
            WellKnownConfigurationManager.cache.set(url, extractedData);
            return data;
        } catch (error) {
            throw new Error(`Failed to fetch configuration from ${url}: ${error.message}`);
        }
    }

    /**
     * Fetches configuration data from all URLs and returns the results.
     * @returns {Promise<void>} - An array of configuration data from all URLs.
     */
    async fetchAllConfigurations() {
        for (const url of this.urls) {
            try {
                const config = await this.fetchConfiguration(url);
            } catch (error) {
                logError('Error fetching configuration', {url: url, error: error.message});
            }
        }
    }

    /**
     * Fetches the well-known configuration for a specific issuer.
     * @param issuer
     * @returns {Promise<WellKnownConfigurationInfo|undefined>}
     */
    async getWellKnownConfigurationForIssuer(issuer) {
        if (WellKnownConfigurationManager.cache.size === 0 && this.urls.length > 0) {
            await this.fetchAllConfigurations();
        }
        for (const url of this.urls) {
            try {
                const config = await this.fetchConfiguration(url);
                if (config.issuer === issuer) {
                    return config;
                }
            } catch (error) {
                logError('Error fetching configuration', {url: url, error: error.message});
            }
        }
    }

    /**
     * @returns {Promise<string[]>}
     */
    async getJwksUrls() {
        /**
         * @type {string[]}
         */
        const jwksUrls = [];
        for (const url of this.urls) {
            try {
                const config = await this.fetchConfiguration(url);
                if (config.jwks_uri) {
                    jwksUrls.push(config.jwks_uri);
                }
            } catch (error) {
                logError('Error fetching configuration', {url: url, error: error.message});
            }
        }
        return jwksUrls;
    }
}

module.exports = {
    WellKnownConfigurationManager
};
