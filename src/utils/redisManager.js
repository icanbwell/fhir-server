const { logError } = require('../operations/common/logging');
const { captureException } = require('../operations/common/sentry');
const { RedisClient } = require('./redisClient');

/**
 * Manages Redis for caching FHIR resources
 */
class RedisManager {
    /**
     * @param {RedisClient} redisClient
     */
    constructor({ redisClient }) {
        /**
         * @type {RedisClient}
         */
        this.redisClient = redisClient;
        this.defaultTtlSeconds = parseInt(process.env.REDIS_KEY_DEFAULT_TTL_SECONDS) || 600;
    }

    /**
     * write entire bundle to Redis
     * @param {string} cacheKey
     * @param {Object} bundle
     * @param {number|undefined} ttlSeconds
     */
    async writeBundleAsync(cacheKey, bundle, ttlSeconds = null) {
        ttlSeconds = ttlSeconds || this.defaultTtlSeconds;
        try {
            await this.redisClient.connectAsync();
            await this.redisClient.set(cacheKey, JSON.stringify(bundle), ttlSeconds);
        } catch (error) {
            logError('Error writing bundle to Redis', { error, cacheKey });
            await this.redisClient.deleteKey(cacheKey);
            captureException(error);
        }
    }

    /**
     * Check if a Redis cache exists
     * @param {string} cacheKey
     * @returns {Promise<boolean>}
     */
    async hasCacheKeyAsync(cacheKey) {
        try {
            await this.redisClient.connectAsync();
            return await this.redisClient.hasKey(cacheKey);
        } catch (error) {
            logError('Error checking Redis cache', { error, cacheKey });
            return false;
        }
    }

    /**
     * Get cache value for the given key
     * @param {string} cacheKey
     * @returns {Promise<string|null>}
     */
    async getCacheAsync(cacheKey) {
        try {
            await this.redisClient.connectAsync();
            return await this.redisClient.get(cacheKey);
        } catch (error) {
            logError('Error getting Redis cache', { error, cacheKey });
            throw error;
        }
    }

    /**
     * Increment generation for the given cache key
     * @param {string} cacheKey
     * @returns {Promise<number>}
     */
    async incrementGenerationAsync(cacheKey) {
        try {
            await this.redisClient.connectAsync();
            return await this.redisClient.incr(cacheKey);
        } catch (error) {
            logError('Error incrementing generation in Redis', { error, cacheKey });
            captureException(error);
            throw error;
        }
    }

    async deleteKeyAsync(cacheKey) {
        try {
            await this.redisClient.connectAsync();
            await this.redisClient.deleteKey(cacheKey);
        } catch (error) {
            logError('Error deleting Redis cache', { error, cacheKey });
            captureException(error);
        }
    }

    /**
     * Read bundle from Redis cache
     * @param {string} cacheKey
     * @returns {Promise<Object|null>}
     */
    async readBundleFromCacheAsync(cacheKey) {
        try {
            await this.redisClient.connectAsync();
            const response = await this.redisClient.get(cacheKey);
            if (response) {
                return JSON.parse(response);
            }
            return null;
        } catch (error) {
            logError('Error reading bundle from Redis', { error, cacheKey });
            captureException(error);
        }
    }
}

module.exports = {
    RedisManager
};
