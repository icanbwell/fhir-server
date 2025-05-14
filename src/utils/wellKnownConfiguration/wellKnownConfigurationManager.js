const superagent = require('superagent');
const {LRUCache} = require('lru-cache');
const {logError} = require("../../operations/common/logging");

/**
 * @typedef {Object} WellKnownConfigurationInfo
 * @property {string} authorizationEndpoint - The authorization endpoint URL.
 * @property {string} tokenEndpoint - The token endpoint URL.
 * @property {string} userinfoEndpoint - The userinfo endpoint URL.
 * @property {string} jwksUri - The JWKS URI.
 * @property {string} issuer - The issuer URL.
 */

class WellKnownConfigurationManager {
    /**
     * @param {string} urls - Comma-separated list of configuration endpoint URLs.
     * @param {Object} [cacheOptions] - Options for the LRU cache.
     */
    constructor(urls, cacheOptions = {}) {
        /**
         * @type {string[]}
         */
        this.urls = urls.split(',').map(url => url.trim());
        /**
         * Cache for configuration data.
         * @type {LRUCache<{}, {}, unknown>}
         */
        this.cache = new LRUCache({
            max: cacheOptions.max || 100, // Maximum number of items in the cache
            ttl: cacheOptions.ttl || 24 * 60 * 1000 // Time-to-live in milliseconds
        });
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
            authorizationEndpoint: config.authorization_endpoint,
            tokenEndpoint: config.token_endpoint,
            userinfoEndpoint: config.userinfo_endpoint,
            jwksUri: config.jwks_uri,
            issuer: config.issuer
        };
    }

    /**
     * Fetches configuration data from a given URL and caches it.
     * @param {string} url - The URL to fetch data from.
     * @returns {Promise<WellKnownConfigurationInfo>} - The fetched configuration data.
     */
    async fetchConfiguration(url) {
        if (this.cache.has(url)) {
            return this.cache.get(url);
        }

        try {
            const response = await superagent.get(url).set({Accept: 'application/json'});
            const data = JSON.parse(response.text);
            /**
             * @type {WellKnownConfigurationInfo}
             */
            const extractedData = this.extractConfigurationDetails(data);
            this.cache.set(url, extractedData);
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
        if (this.cache.size === 0 && this.urls.length > 0) {
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
}

module.exports = {
    WellKnownConfigurationManager
};
