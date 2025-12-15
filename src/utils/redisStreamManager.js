const { logError, logInfo } = require('../operations/common/logging');
const { captureException } = require('../operations/common/sentry');

/**
 * Manages Redis Streams for caching FHIR resources
 */
class RedisStreamManager {
    /**
     * @param {RedisClient} redisClient
     */
    constructor({ redisClient }) {
        this.redisClient = redisClient;
        this.defaultTtlSeconds = parseInt(process.env.REDIS_KEY_DEFAULT_TTL_SECONDS) || 600;
    }

    /**
     * Write bundle entry to Redis Stream
     * @param {string} cacheKey
     * @param {Object} bundleEntry
     * @param {number} ttlSeconds
     * @returns {Promise<void>}
     */
    async writeBundleEntryToStream(cacheKey, bundleEntry, ttlSeconds = null) {
        ttlSeconds = ttlSeconds || this.defaultTtlSeconds;
        try {
            await this.redisClient.connectAsync();
            await this.redisClient.addStreamEntry(
                cacheKey, JSON.stringify(bundleEntry), ttlSeconds
            );
        } catch (error) {
            logError('Error writing to Redis stream', { error, cacheKey });
            captureException(error);
        }
    }

    async deleteStream(cacheKey) {
        try {
            await this.redisClient.connectAsync();
            await this.redisClient.deleteKey(cacheKey);
        } catch (error) {
            logError('Error deleting Redis stream', { error, cacheKey });
            captureException(error);
        }
    }
}

module.exports = {
    RedisStreamManager
};
