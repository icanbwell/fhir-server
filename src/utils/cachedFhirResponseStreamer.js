const { BaseResponseStreamer } = require('./baseResponseStreamer');
const { logInfo } = require('../operations/common/logging');

/**
 * Extends BaseResponseStreamer to support Redis Stream caching
 */
class CachedFhirResponseStreamer {
    /**
     * @param {RedisStreamManager} redisStreamManager
     * @param {string} cacheKey
     * @param {BaseResponseStreamer} responseStreamer
     * @param {number} ttlSeconds
     */
    constructor({
        redisStreamManager,
        cacheKey,
        responseStreamer,
        ttlSeconds
    }) {
        this.redisStreamManager = redisStreamManager;
        this.cacheKey = cacheKey;
        this.responseStreamer = responseStreamer;
        this.ttlSeconds = ttlSeconds;
        this.isFirstEntry = true;
    }

    /**
     * Write bundle entry to response AND Redis cache
     * @param {BundleEntry} bundleEntry
     * @returns {Promise<void>}
     */
    async writeBundleEntryToRedis({ bundleEntry }) {
        if (this.redisStreamManager && this.cacheKey) {
            if (this.isFirstEntry) {
                await this.redisStreamManager.deleteStream(this.cacheKey);
                this.isFirstEntry = false;
            }

            await this.redisStreamManager.writeBundleEntryToStream(
                this.cacheKey,
                bundleEntry,
                this.ttlSeconds
            );
        }
    }

    /**
     * Stream from Redis cache
     * @returns {Promise<void>}
     */
    async streamFromCacheAsync() {
        await this.responseStreamer.startAsync();
        let count = 0;
        let { entries, hasMore, lastId } = {entries: [], hasMore: true, lastId: '0-0'};
        while (hasMore) {
            ({ entries, hasMore, lastId } = await this.redisStreamManager.readBundleEntriesFromStream(this.cacheKey, lastId));
            for (const bundleEntry of entries) {
                await this.responseStreamer.writeBundleEntryAsync({ bundleEntry });
                count++;
            }
        }
        await this.responseStreamer.endAsync();
    }
}

module.exports = {
    CachedFhirResponseStreamer
};
