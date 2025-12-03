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
    }

    /**
     * Generate cache key for $everything operation
     * @param {string} resourceType
     * @param {Object} parsedArgs
     * @returns {string}
     */
    generateCacheKey({ resourceType, parsedArgs }) {
        // Create a deterministic key based on query parameters
        const sortedParams = Object.keys(parsedArgs)
            .filter(k => !k.startsWith('_')) // Exclude internal params
            .sort()
            .map(k => `${k}=${parsedArgs[k]}`)
            .join('&');

        return `fhir:everything:${resourceType}:${sortedParams}`;
    }

    /**
     * Check if cached stream exists
     * @param {string} cacheKey
     * @returns {Promise<boolean>}
     */
    async hasCachedStream(cacheKey) {
        try {
            await this.redisClient.connectAsync();
            const exists = await this.redisClient.client.exists(cacheKey);
            return exists === 1;
        } catch (error) {
            logError('Error checking Redis stream cache', { error, cacheKey });
            return false;
        }
    }

    /**
     * Write bundle entry to Redis Stream
     * @param {string} cacheKey
     * @param {Object} bundleEntry
     * @returns {Promise<void>}
     */
    async writeBundleEntryToStream(cacheKey, bundleEntry) {
        try {
            await this.redisClient.connectAsync();

            // Add entry to Redis Stream
            await this.redisClient.client.xAdd(
                cacheKey,
                '*', // Auto-generate ID
                {
                    data: JSON.stringify(bundleEntry),
                    timestamp: Date.now().toString()
                }
            );

            // Set expiration on first write
            await this.redisClient.client.expire(cacheKey, 600);
        } catch (error) {
            logError('Error writing to Redis stream', { error, cacheKey });
            captureException(error);
            // Don't throw - allow request to continue without caching
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

            let hasMore = true;

            const entries = [];
            const streamInfo = await this.redisClient.client.xInfoStream(cacheKey);
            const lastEntryId = streamInfo['last-entry'].id;
            // Read 100 entries at a time
            const results = await this.redisClient.client.xRead(
                { key: cacheKey, id: lastId },
                { COUNT: 300, BLOCK: 0 }
            );

            if (!results || results.length === 0) {
                hasMore = false;
                return { entries, hasMore, lastId };
            }

            const messages = results[0].messages;

            for (const message of messages) {
                entries.push(JSON.parse(message.message.data));
                lastId = message.id;
            }

            if (lastId === lastEntryId) {
                hasMore = false;
            }
            logInfo('Finished reading from Redis stream', { cacheKey, lastId });
            console.log('byeeeeeeeeee');
            return { entries, hasMore, lastId };
        } catch (error) {
            logError('Error reading from Redis stream', { error, cacheKey });
            captureException(error);
            // Don't yield anything - will fall back to database
        }
    }

    /**
     * Invalidate cached stream
     * @param {string} cacheKey
     * @returns {Promise<void>}
     */
    async invalidateStream(cacheKey) {
        try {
            await this.redisClient.connectAsync();
            await this.redisClient.client.del(cacheKey);
            logInfo('Invalidated Redis stream cache', { cacheKey });
        } catch (error) {
            logError('Error invalidating Redis stream', { error, cacheKey });
        }
    }

    /**
     * Get metadata about cached stream
     * @param {string} cacheKey
     * @returns {Promise<Object|null>}
     */
    async getStreamMetadata(cacheKey) {
        try {
            await this.redisClient.connectAsync();

            const info = await this.redisClient.client.xInfoStream(cacheKey);
            const ttl = await this.redisClient.client.ttl(cacheKey);

            return {
                length: info.length,
                firstEntry: info['first-entry'],
                lastEntry: info['last-entry'],
                ttl: ttl,
                expiresAt: ttl > 0 ? new Date(Date.now() + ttl * 1000).toISOString() : null
            };
        } catch (error) {
            logError('Error getting stream metadata', { error, cacheKey });
            return null;
        }
    }
}

module.exports = {
    RedisStreamManager
};