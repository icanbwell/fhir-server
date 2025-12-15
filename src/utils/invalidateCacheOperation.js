const { BadRequestError } = require("./httpErrors");

class InvalidateCacheOperation {
    constructor({ redisClient }) {
        /**
         * @type {RedisClient}
         */
        this.redisClient = redisClient;
    }

    /**
     * Invalidates cache for a given key
     * @param {string} cacheKey
     * @return {Promise<void>}
     */
    async invalidateCacheAsync({ resourceType, resourceId }) {
        let prefix;
        if (resourceType === 'Patient') {
            prefix = `Patient:${resourceId}`;
        }
        else if (resourceType === 'Person') {
            prefix = `ClientPerson:${resourceId}`;
        }
        else {
            throw new BadRequestError(`Unsupported resource type for cache invalidation: ${resourceType}`);
        }
        await this.redisClient.connectAsync();
        await this.redisClient.invalidateByPrefixAsync(prefix);
    }
}

module.exports = {
    InvalidateCacheOperation
};
