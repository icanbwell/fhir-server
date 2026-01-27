const { assertTypeEquals } = require('./assertType');
const { ConfigManager } = require('./configManager');
const { RedisClient } = require('./redisClient');

class FilteringRulesCacheManager {
    /**
     * @param {Object} params
     * @param {RedisClient} params.redisClient
     * @param {ConfigManager} params.configManager
     */
    constructor({ redisClient, configManager }) {
        this.redisClient = redisClient;
        assertTypeEquals(redisClient, RedisClient);
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
        this.defaultTtlSeconds = this.configManager.delegatedAccessFilteringRulesCacheTtlSeconds;
    }

    /**
     * @param {string} personIdFromJwtToken
     * @param {string} delegatedActor
     * @param {import('./delegatedActorRulesManager').DelegatedActorFilteringRules} value
     * @param {number} [ttlSeconds=this.defaultTtlSeconds]
     */
    async setKeyAsync(
        personIdFromJwtToken,
        delegatedActor,
        value,
        ttlSeconds = this.defaultTtlSeconds
    ) {
        const key = this._getKey(personIdFromJwtToken, delegatedActor);
        return this.redisClient.set(key, value, ttlSeconds);
    }

    async hasKeyAsync(personIdFromJwtToken, delegatedActor) {
        const key = this._getKey(personIdFromJwtToken, delegatedActor);
        return this.redisClient.hasKey(key);
    }

    async deleteKeyAsync(personIdFromJwtToken, delegatedActor) {
        const key = this._getKey(personIdFromJwtToken, delegatedActor);
        return this.redisClient.deleteKey(key);
    }

    _getKey(personIdFromJwtToken, delegatedActor) {
        return `delegatedAccessFilteringRules:${personIdFromJwtToken}:${delegatedActor}`;
    }
}

module.exports = { FilteringRulesCacheManager };
