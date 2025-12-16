const { BaseResponseStreamer } = require('./baseResponseStreamer');
const {EnrichmentManager} = require('../enrich/enrich');
const { RedisStreamManager } = require('./redisStreamManager');
const { ParsedArgs } = require('../operations/query/parsedArgs');

/**
 * Extends BaseResponseStreamer to support Redis Stream caching
 */
class CachedFhirResponseStreamer {
    /**
     * @param {RedisStreamManager} redisStreamManager
     * @param {string} cacheKey
     * @param {BaseResponseStreamer} responseStreamer
     * @param {number} ttlSeconds
     * @param {EnrichmentManager} enrichmentManager
     * @param {ParsedArgs} parsedArgs
     */
    constructor({
        redisStreamManager,
        cacheKey,
        responseStreamer,
        ttlSeconds,
        enrichmentManager,
        parsedArgs
    }) {
        this.redisStreamManager = redisStreamManager;
        this.cacheKey = cacheKey;
        this.responseStreamer = responseStreamer;
        this.ttlSeconds = ttlSeconds;
        this.enrichmentManager = enrichmentManager;
        this.parsedArgs = parsedArgs;
        this.isFirstEntry = true;
        this.writeFromRedisStarted = false;
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
     * @returns {Promise<object[]>}
     */
    async streamFromCacheAsync() {
        let streamedResources = [];
        let { entries, lastId } = await this.redisStreamManager.readBundleEntriesFromStream(this.cacheKey, '0-0');
        this.responseStreamer.response.setHeader('X-Cache', 'Hit');
        this.writeFromRedisStarted = true;
        const streamInfo = await this.redisStreamManager.redisClient.getStreamInfo(this.cacheKey);
        const lastEntryId = streamInfo['last-entry'].id;
        while (entries.length > 0) {
            await this.enrichmentManager.enrichBundleEntriesAsync({
                entries: entries,
                parsedArgs: this.parsedArgs
            });
            for (const bundleEntry of entries) {
                await this.responseStreamer.writeBundleEntryAsync({ bundleEntry });
                streamedResources.push({
                    id: bundleEntry.resource.id,
                    resourceType: bundleEntry.resource.resourceType
                });
            }
            if (lastEntryId !== lastId) {
                ({ entries, lastId } = await this.redisStreamManager.readBundleEntriesFromStream(this.cacheKey, lastId));
            }
            else {
                entries = [];
            }
        }
        return streamedResources;
    }
}

module.exports = {
    CachedFhirResponseStreamer
};
