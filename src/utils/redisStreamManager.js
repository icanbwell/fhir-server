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

    /**
     * Check if a Redis stream exists
     * @param {string} cacheKey
     * @returns {Promise<boolean>}
     */
    async hasCachedStream(cacheKey) {
        try {
            await this.redisClient.connectAsync();
            return await this.redisClient.hasKey(cacheKey);
        } catch (error) {
            logError('Error checking Redis stream cache', { error, cacheKey });
            return false;
        }
    }

    /**
     * Read all entries from Redis Stream
     * @param {string} cacheKey
     * @returns {Promise<Array<Object>>}
     */
    async readBundleEntriesFromStream(cacheKey, lastId) {
        try {
            await this.redisClient.connectAsync();
            let entries = [];
            const streamCount = parseInt(process.env.REDIS_STREAM_READ_COUNT) || 100;
            const results = await this.redisClient.readFromStream(cacheKey, lastId, streamCount);
            if (!results || results.length === 0) {
                return { entries: [], lastId };
            }
            const messages = results[0].messages;
            for (const message of messages) {
                entries.push(JSON.parse(message.message.data));
                lastId = message.id;
            }
            return { entries, lastId };
        } catch (error) {
            logError('Error reading from Redis stream', { error, cacheKey });
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
