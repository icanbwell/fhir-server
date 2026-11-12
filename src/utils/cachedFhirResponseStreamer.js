const { BaseResponseStreamer } = require('./baseResponseStreamer');
const {EnrichmentManager} = require('../enrich/enrich');
const { RedisStreamManager } = require('./redisStreamManager');
const { ParsedArgs } = require('../operations/query/parsedArgs');
const { createViewControlHiddenResourceMatcher } = require('./viewControlHiddenResourceMatcher');

/**
 * Extends BaseResponseStreamer to support Redis Stream caching
 */
class CachedFhirResponseStreamer {
    /**
     * @param {RedisStreamManager} redisStreamManager
     * @param {string} cacheKey
     * @param {BaseResponseStreamer} responseStreamer
     * @param {number} ttlSeconds
     * @param {EnrichmentManager|null} enrichmentManager
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
     * Process a batch of entries
     * @param {Array} entries
     * @param {Array} streamedResources
     * @param {import('../enrich/providers/enrichmentProvider').EnrichmentContext|undefined} [enrichmentContext]
     * @param {((resource: Object) => boolean)|null} [isHidden] drops the entries it matches
     * @returns {Promise<void>}
     */
    async processEntriesBatch({ entries, streamedResources, enrichmentContext, isHidden = null }) {
        const visibleEntries = isHidden
            ? entries.filter((bundleEntry) => !isHidden(bundleEntry.resource))
            : entries;
        if (this.enrichmentManager) {
            await this.enrichmentManager.enrichBundleEntriesAsync({
                entries: visibleEntries,
                parsedArgs: this.parsedArgs,
                enrichmentContext
            });
        }
        for (const bundleEntry of visibleEntries) {
            const { _uuid, resourceType } = bundleEntry.resource;
            await this.responseStreamer.writeBundleEntryAsync({ bundleEntry });
            streamedResources.push({ _uuid, resourceType });
        }
    }

    /**
     * Stream from Redis cache
     * @param {Array} [streamedResources] - accumulator pushed into by reference (by
     *  processEntriesBatch) so it survives a throw from any batch after the first
     * @param {import('../enrich/providers/enrichmentProvider').EnrichmentContext|undefined} [enrichmentContext]
     *  for the enrichment of each replayed entry. Entries are cached before enrichment, so
     *  request-specific filtering happens here: entries the current view-control lookup
     *  (enrichmentContext.viewControlExcludeMap) hides are dropped, and so are the Composition
     *  sections that reference them. The cached entry may predate the Consent.
     * @returns {Promise<object[]>}
     */
    async streamFromCacheAsync({ streamedResources = [], enrichmentContext } = {}) {
        const isHidden = createViewControlHiddenResourceMatcher(enrichmentContext?.viewControlExcludeMap);
        let { entries, hasMore, lastId } = await this.redisStreamManager.readBundleEntriesFromStream(this.cacheKey, '0-0');
        this.responseStreamer.response.setHeader('X-Cache', 'Hit');
        await this.processEntriesBatch({ entries, streamedResources, enrichmentContext, isHidden });
        this.writeFromRedisStarted = true;
        while (hasMore){
            ({ entries, hasMore, lastId } = await this.redisStreamManager.readBundleEntriesFromStream(this.cacheKey, lastId));
            await this.processEntriesBatch({ entries, streamedResources, enrichmentContext, isHidden });
        }
        return streamedResources;
    }
}

module.exports = {
    CachedFhirResponseStreamer
};
