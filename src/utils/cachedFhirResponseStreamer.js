const { FhirResponseStreamer } = require('./fhirResponseStreamer');
const { logInfo } = require('../operations/common/logging');

/**
 * Extends FhirResponseStreamer to support Redis Stream caching
 */
class CachedFhirResponseStreamer extends FhirResponseStreamer {
    /**
     * @param {import('express').Response} response
     * @param {string} requestId
     * @param {string} bundleType
     * @param {RedisStreamManager} redisStreamManager
     * @param {string} cacheKey
     * @param {boolean} writeToCache
     */
    constructor({
        response,
        requestId,
        bundleType = 'searchset',
        redisStreamManager,
        cacheKey
    }) {
        super({ response, requestId, bundleType });

        this.redisStreamManager = redisStreamManager;
        this.cacheKey = cacheKey;
    }

    /**
     * Write bundle entry to response AND Redis cache
     * @param {BundleEntry} bundleEntry
     * @returns {Promise<void>}
     */
    async writeBundleEntryAsync({ bundleEntry }) {
        // Write to HTTP response (existing behavior)
        await super.writeBundleEntryAsync({ bundleEntry });

        // Also write to Redis Stream for caching
        if (this.redisStreamManager && this.cacheKey) {
            console.log(`Writing bundle entry with ID ${bundleEntry.resource.id} to Redis Stream with key ${this.cacheKey}`);
            await this.redisStreamManager.writeBundleEntryToStream(
                this.cacheKey,
                bundleEntry
            );
        }
    }

    /**
     * Stream from Redis cache
     * @returns {Promise<void>}
     */
    async streamFromCacheAsync() {
        logInfo('Streaming from Redis cache', { cacheKey: this.cacheKey });

        await this.startAsync();

        let count = 0;
        let { entries, hasMore, lastId } = {entries: [], hasMore: true, lastId: '0-0'};
        while (hasMore) {
            ({ entries, hasMore, lastId } = await this.redisStreamManager.readBundleEntriesFromStream(this.cacheKey, lastId));
            for (const bundleEntry of entries) {
                await super.writeBundleEntryAsync({ bundleEntry });
                count++;
            }
        }

        logInfo('Streamed from Redis cache', { cacheKey: this.cacheKey, count });

        await this.endAsync();
    }
}

module.exports = {
    CachedFhirResponseStreamer
};
