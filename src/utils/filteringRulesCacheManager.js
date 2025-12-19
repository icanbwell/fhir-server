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
     * @param {string} personFromJwtToken
     * @param {string} delegatedActor
     * @param {import('./delegatedActorRulesManager').DelegatedActorFilteringRules} value
     * @param {number} [ttlSeconds=this.defaultTtlSeconds]
     */
    setKeyAsync(
        personFromJwtToken,
        delegatedActor,
        value,
        ttlSeconds = this.defaultTtlSeconds
    ) {
        const key = this._getKey(personFromJwtToken, delegatedActor);
        return this.redisClient.set(key, value, ttlSeconds);
    }

    hasKeyAsync(personFromJwtToken, delegatedActor) {
        const key = this._getKey(personFromJwtToken, delegatedActor);
        return this.redisClient.hasKey(key);
    }

    deleteKeyAsync(personFromJwtToken, delegatedActor) {
        const key = this._getKey(personFromJwtToken, delegatedActor);
        return this.redisClient.deleteKey(key);
    }

    _getKey(personFromJwtToken, delegatedActor) {
        return `delegatedAccessFilteringRules:${personFromJwtToken}:${delegatedActor}`;
    }
}

module.exports = { FilteringRulesCacheManager };
