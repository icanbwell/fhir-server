const { BaseCacheKeyGenerator } = require('../operations/common/baseCacheKeyGenerator');
const { RedisClient } = require('./redisClient');

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
        await this.redisClient.connectAsync();
        await this.redisClient.bulkDeleteKeys(cacheKeys);
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
