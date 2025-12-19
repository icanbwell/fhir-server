const { assertTypeEquals, assertIsValid } = require('./assertType');
const { ConfigManager } = require('./configManager');
const { DatabaseQueryFactory } = require('../dataLayer/databaseQueryFactory');
const { FilteringRulesCacheManager } = require('./filteringRulesCacheManager');
const { CustomTracer } = require('./customTracer');

/**
 * @typedef DelegatedActorFilteringRules
 * @property {string[]} allowedResourceTypes - List of resource types allowed
 * @property {string[]} deniedSensitiveCategories - List of sensitive categories denied
 */

/**
 * Manager for handling filtering rules for delegated actors
 */
class DelegatedActorRulesManager {
    /**
     * @param {Object} params
     * @param {ConfigManager} params.configManager
     * @param {DatabaseQueryFactory} params.databaseQueryFactory
     * @param {FilteringRulesCacheManager} params.filteringRulesCacheManager
     * @param {CustomTracer} params.customTracer
     */
    constructor({ configManager, databaseQueryFactory, filteringRulesCacheManager, customTracer }) {
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        /**
         * @type {FilteringRulesCacheManager}
         */
        this.filteringRulesCacheManager = filteringRulesCacheManager;
        assertTypeEquals(filteringRulesCacheManager, FilteringRulesCacheManager);

        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);

        /**
         * @type {CustomTracer}
         */
        this.customTracer = customTracer;
        assertTypeEquals(customTracer, CustomTracer);
    }

    /**
     * Returns the filtering rules for a delegated actor
     * If no delegated actor present, then return nulls.
     * If delegated actor doesn't have valid consent, then return empty filtering rules.
     *
     * @param {Object} params
     * @param {string} params.base_version
     * @param {string | null} params.delegatedActor
     * @param {string} params.personIdFromJwtToken
     *
     * @return {Promise<{
     *  filteringRules: DelegatedActorFilteringRules | null,
     *  actorConsentQueries: QueryItem[],
     *  actorConsentQueryOptions: import('mongodb').FindOptions<import('mongodb').DefaultSchema>[]
     * } | null>}
     */
    async getFilteringRulesAsync({ delegatedActor, personIdFromJwtToken, base_version = '4_0_0' }) {
        return await this.customTracer.trace(
            'DelegatedActorRulesManager.getFilteringRulesAsync',
            async () => {
                if (!this.isUserDelegatedActor({ delegatedActor })) {
                    return null;
                }

                assertIsValid(personIdFromJwtToken, 'personIdFromJwtToken is required');
                assertIsValid(delegatedActor, 'delegatedActor is required');

                // TODO: Check cache first
                // Fetch Consent resources directly using DatabaseQueryFactory
                // TODO: Parse consents to extract filtering rules
                const filteringRules = null;
                // TODO: Cache the result
                return {
                    filteringRules,
                    actorConsentQueries: [],
                    actorConsentQueryOptions: []
                };
            }
        );
    }

    /**
     * Check if the user is delegated actor
     * @param {Object} params
     * @param {string | null} params.delegatedActor
     * @returns {boolean}
     */
    isUserDelegatedActor({ delegatedActor }) {
        return this.configManager.enabledDelegatedAccessFiltering && !!delegatedActor;
    }
}

module.exports = {
    DelegatedActorRulesManager
};
