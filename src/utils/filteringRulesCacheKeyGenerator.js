const { assertTypeEquals } = require('./assertType');
const { RedisManager } = require('./redisManager');
const { logError } = require('../operations/common/logging');

class FilteringRulesCacheKeyGenerator {
    /**
     * @param {Object} params
     * @param {RedisManager} params.redisManager
     */
    constructor({ redisManager }) {
        /**
         * @type {RedisManager}
         */
        this.redisManager = redisManager;
        assertTypeEquals(redisManager, RedisManager);
    }

    /**
     * Gets the generation key for a person+actor pair
     * @param {string} personIdFromJwtToken
     * @param {string} actorReference
     * @returns {string}
     * @private
     */
    _getGenerationKey(personIdFromJwtToken, actorReference) {
        return `delegatedAccessFilteringRules:${personIdFromJwtToken}:${actorReference}:Generation`;
    }

    /**
     * Gets the current generation, or initializes it if missing
     * @param {string} personIdFromJwtToken
     * @param {string} actorReference
     * @returns {Promise<number|undefined>}
     */
    async getGenerationAsync(personIdFromJwtToken, actorReference) {
        try {
            const generationKey = this._getGenerationKey(personIdFromJwtToken, actorReference);
            const existing = await this.redisManager.getCacheAsync(generationKey);
            if (existing) {
                const parsed = Number.parseInt(existing, 10);
                if (!Number.isNaN(parsed)) {
                    return parsed;
                }
            }
            return await this.redisManager.incrementGenerationAsync(generationKey);
        } catch (error) {
            logError('Error fetching generation for filtering rules cache', { error });
            return undefined;
        }
    }

    /**
     * Generates the full cache key with generation embedded.
     * Returns undefined if generation is unavailable (cache should be skipped).
     * @param {string} personIdFromJwtToken
     * @param {string} actorReference
     * @returns {Promise<string|undefined>}
     */
    async generateCacheKeyAsync(personIdFromJwtToken, actorReference) {
        const generation = await this.getGenerationAsync(personIdFromJwtToken, actorReference);
        if (generation === undefined) {
            return undefined;
        }
        return `delegatedAccessFilteringRules:${personIdFromJwtToken}:${actorReference}:Gen:${generation}`;
    }
}

module.exports = { FilteringRulesCacheKeyGenerator };
