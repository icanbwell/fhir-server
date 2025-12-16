class FhirCacheKeyManager {
    constructor({ redisClient }) {
        /**
         * @type {RedisClient}
         */
        this.redisClient = redisClient;
    }

    /**
     * Generates a cache key prefix for a given resource type and ID.
     * @param {string} resourceType
     * @param {string} resourceId
     * @return {Promise<string>}
     */
    generateCacheKeyPrefix({ resourceType, resourceId }) {
        let prefix;
        if (resourceType === 'Patient') {
            prefix = `Patient:${resourceId}`;
        }
        else if (resourceType === 'Person') {
            prefix = `ClientPerson:${resourceId}`;
        }
        return prefix;
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
        const prefix = this.generateCacheKeyPrefix({ resourceType, resourceId });
        return prefix ? this.redisClient.invalidateByPrefixAsync(prefix) : undefined;
    }

    /**
     * Retrieves all cache keys for a given resource type and ID.
     * @param {string} resourceType
     * @param {string} resourceId
     * @returns {Promise<string[]>}
     */
    async getAllKeysForResource({ resourceType, resourceId }) {
        await this.redisClient.connectAsync();
        const prefix = this.generateCacheKeyPrefix({ resourceType, resourceId });
        return this.redisClient.getAllKeysByPrefix(prefix);
    }
}

module.exports = {
    FhirCacheKeyManager
};
