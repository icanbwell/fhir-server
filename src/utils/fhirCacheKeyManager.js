const { BaseCacheKeyGenerator } = require('../operations/common/baseCacheKeyGenerator');
const { RedisClient } = require('./redisClient');
const { logWarn } = require('../operations/common/logging');

// Cache keys this manager may delete must live under the FHIR cache namespace this class
// (and its subclasses, e.g. PatientEverythingCacheKeyGenerator / SummaryCacheKeyGenerator)
// actually generates via generateIdComponent(): `(Patient|ClientPerson):<id>:...` (operation,
// :Scopes:<hash>, and :Generation suffixes all vary by generator, so only the namespace
// prefix -- the one thing every generator shares -- is validated here). invalidateCacheKeys()
// is reachable from an admin API endpoint with a caller-supplied key array; without this
// check, any admin-scoped caller could delete arbitrary Redis keys, not just entries in the
// FHIR response cache.
const FHIR_CACHE_KEY_NAMESPACE_RE = /^(Patient|ClientPerson):/;

class FhirCacheKeyManager {
    constructor({ redisClient }) {
        /**
         * @type {RedisClient}
         */
        this.redisClient = redisClient;
        this.keyGenerator = new BaseCacheKeyGenerator();
    }

    /**
     * Invalidates cache for a given key
     * @param {string} cacheKey
     * @return {Promise<void>}
     */
    async invalidateCacheKeys({ cacheKeys }) {
        const safeCacheKeys = (cacheKeys || []).filter((key) => {
            const isSafe = typeof key === 'string' && FHIR_CACHE_KEY_NAMESPACE_RE.test(key);
            if (!isSafe) {
                logWarn(`Ignoring cacheKey outside the FHIR cache namespace: ${key}`);
            }
            return isSafe;
        });
        await this.redisClient.connectAsync();
        await this.redisClient.bulkDeleteKeys(safeCacheKeys);
    }

    /**
     * Invalidates cache for a given prefix
     * @param {string} prefix
     * @return {Promise<void>}
     */
    async invalidateCacheKeysForResource({ resourceType, resourceId }) {
        await this.redisClient.connectAsync();
        const prefix = this.keyGenerator.generateIdComponent({ id: resourceId, isPersonId: resourceType === 'Person' });
        return prefix ? this.redisClient.invalidateByPrefixAsync(prefix) : undefined;
    }

    /**
     * Retrieves all cache keys for a given resource type and ID.
     * @param {string} resourceType
     * @param {string} resourceId
     * @returns {Promise<{ cacheKeys: string[], generationKeys: { key: string, value: string }[] }>}
     */
    async getAllKeysForResource({ resourceType, resourceId }) {
        await this.redisClient.connectAsync();
        const prefix = this.keyGenerator.generateIdComponent({ id: resourceId, isPersonId: resourceType === 'Person' });
        const keys = await this.redisClient.getAllKeysByPrefix(prefix);

        // Separate cache keys from generation keys
        const { generationKeysList, cacheKeys } = keys.reduce(
            (acc, key) => {
                if (key.endsWith(':Generation')) {
                    acc.generationKeysList.push(key);
                } else {
                    acc.cacheKeys.push(key);
                }
                return acc;
            },
            { generationKeysList: [], cacheKeys: [] }
        );

        // Fetch generation values for all generation keys in parallel
        const generationKeys = await Promise.all(
            generationKeysList.map(async (generationKey) => {
                const generationValue = await this.redisClient.get(generationKey);
                return { key: generationKey, value: generationValue };
            })
        );

        return { cacheKeys, generationKeys };
    }
}

module.exports = {
    FhirCacheKeyManager
};
