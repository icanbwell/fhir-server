const { assertTypeEquals } = require('../../utils/assertType');
const { ConfigManager } = require('../../utils/configManager');
const { DelegatedActorRulesManager } = require('../../utils/delegatedActorRulesManager');
const { DatabaseQueryFactory } = require('../../dataLayer/databaseQueryFactory');

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
     * @param {string} options.resourceType Resource Type
     * @param {import('mongodb').Filter<import('mongodb').Document>} options.query
     * @param {string} options.requestId Request ID
     * @param {boolean} options.isUser whether request is with patient scope
     * @param {string|null} options.delegatedActor delegated actor from request info
     * @param {string} options.personIdFromJwtToken Person ID from JWT token
     */
    updateQueryForSensitiveData({
        base_version,
        resourceType,
        query,
        requestId,
        isUser,
        delegatedActor,
        personIdFromJwtToken
    }) {
        if (!this.delegatedActorRulesManager.isUserDelegatedActor({ delegatedActor })) {
            return query;
        }
        // TODO: Implement filtering logic based on delegatedActor and delegatedActorFilteringRules

        // return same query for now
        return query;
    }
}

module.exports = { DelegatedAccessQueryManager };
