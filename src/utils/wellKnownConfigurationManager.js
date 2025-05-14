const superagent = require('superagent');
const LRUCache = require('lru-cache');

class WellKnownConfigurationManager {
    /**
     * @param {string} urls - Comma-separated list of configuration endpoint URLs.
     * @param {Object} [cacheOptions] - Options for the LRU cache.
     */
    constructor(urls, cacheOptions = {}) {
        this.urls = urls.split(',').map(url => url.trim());
        this.cache = new LRUCache({
            max: cacheOptions.max || 100, // Maximum number of items in the cache
            ttl: cacheOptions.ttl || 60 * 1000 // Time-to-live in milliseconds
        });
    }

    /**
     * Fetches configuration data from a given URL and caches it.
     * @param {string} url - The URL to fetch data from.
     * @returns {Promise<Object>} - The fetched configuration data.
     */
    async fetchConfiguration(url) {
        if (this.cache.has(url)) {
            return this.cache.get(url);
        }

        try {
            const response = await superagent.get(url).set({ Accept: 'application/json' });
            const data = JSON.parse(response.text);
            this.cache.set(url, data);
            return data;
        } catch (error) {
            throw new Error(`Failed to fetch configuration from ${url}: ${error.message}`);
        }
    }

    /**
     * Fetches configuration data from all URLs and returns the results.
     * @returns {Promise<Object[]>} - An array of configuration data from all URLs.
     */
    async fetchAllConfigurations() {
        const results = [];
        for (const url of this.urls) {
            try {
                const config = await this.fetchConfiguration(url);
                results.push({ url, config });
            } catch (error) {
                results.push({ url, error: error.message });
            }
        }
        return results;
    }
}

module.exports = {
    WellKnownConfigurationManager
};
