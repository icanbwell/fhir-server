const { assertTypeEquals } = require('../../utils/assertType');
const { ConfigManager } = require('../../utils/configManager');
const { DelegatedActorRulesManager } = require('../../utils/delegatedActorRulesManager');
const { DatabaseQueryFactory } = require('../../dataLayer/databaseQueryFactory');
const { MongoQuerySimplifier } = require('../../utils/mongoQuerySimplifier');

class DelegatedAccessQueryManager {
    /**
     * constructor
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {ConfigManager} configManager
     * @param {DelegatedActorRulesManager} delegatedActorRulesManager
     */
    constructor({ databaseQueryFactory, configManager, delegatedActorRulesManager }) {
        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
        /**
         * @type {DelegatedActorRulesManager}
         */
        this.delegatedActorRulesManager = delegatedActorRulesManager;
        assertTypeEquals(delegatedActorRulesManager, DelegatedActorRulesManager);
    }
    /**
     * Update the query to exclude sensitive data based on consent filtering rules
     * @param {Object} options Options object
     * @param {string} options.base_version Base Version
     * @param {import('mongodb').Filter<import('mongodb').Document>} options.query
     * @param {string|null} options.delegatedActor delegated actor from request info
     * @param {string} options.personIdFromJwtToken Person ID from JWT token
     * @returns {Promise<import('mongodb').Filter<import('mongodb').Document>>}
     */
    async updateQueryForSensitiveDataAsync({
        base_version,
        query,
        delegatedActor,
        personIdFromJwtToken
    }) {

        const filteringRuleObj = await this.delegatedActorRulesManager.getFilteringRulesAsync({
            base_version,
            delegatedActor,
            personIdFromJwtToken
        });

        // In this case return original query
        if (!filteringRuleObj) {
            return query;
        }


        const filteringRules = filteringRuleObj?.filteringRules;
        // No filtering rules, return invalid query to block access
        // This will never occur since it will be caught which validating scopes
        if (filteringRules === null) {
            return { id: '__invalid__' };
        }

        const deniedSensitiveCategories = filteringRules?.deniedSensitiveCategories || [];
        if (deniedSensitiveCategories.length === 0) {
            return query;
        }

        const sensitiveCategorySystemIdentifier = this.configManager.sensitiveCategorySystemIdentifier;
        if (!sensitiveCategorySystemIdentifier || sensitiveCategorySystemIdentifier.length === 0) {
            return query;
        }

        // Include resources with no sensitive-category tags,
        // OR include resources with sensitive-category tags as long as their code is NOT denied.
        const sensitiveDataExclusionFilter = {
            $or: [
                {
                    'meta.security': {
                        $not: {
                            $elemMatch: {
                                system: sensitiveCategorySystemIdentifier
                            }
                        }
                    }
                },
                {
                    'meta.security': {
                        $elemMatch: {
                            system: sensitiveCategorySystemIdentifier,
                            code: { $nin: deniedSensitiveCategories }
                        }
                    }
                }
            ]
        };

        const updatedQuery = {
            $and: [query, sensitiveDataExclusionFilter]
        };

        return MongoQuerySimplifier.simplifyFilter({ filter: updatedQuery });
    }
}

module.exports = { DelegatedAccessQueryManager };
