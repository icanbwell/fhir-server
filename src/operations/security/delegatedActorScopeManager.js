const { assertTypeEquals } = require('../../utils/assertType');
const { DelegatedActorRulesManager } = require('../../utils/delegatedActorRulesManager');

/**
 * Manager for validating delegated actor scope permissions
 */
class DelegatedActorScopeManager {
    /**
     * constructor
     * @param {DelegatedActorRulesManager} delegatedActorRulesManager
     */
    constructor({ delegatedActorRulesManager }) {
        /**
         * @type {DelegatedActorRulesManager}
         */
        this.delegatedActorRulesManager = delegatedActorRulesManager;
        assertTypeEquals(delegatedActorRulesManager, DelegatedActorRulesManager);
    }

    /**
     * Returns whether the delegated actor has valid consent to access resources
     * @param {Object} params
     * @param {string | null} params.delegatedActor
     * @param {string} params.personIdFromJwtToken
     * @returns {Promise<boolean>}
     */
    async hasValidConsentAsync({ delegatedActor, personIdFromJwtToken }) {
        const filteringRulesResult = await this.delegatedActorRulesManager.getFilteringRulesAsync({
            delegatedActor,
            personIdFromJwtToken
        });

        // Not a case where delegated actor filtering is required
        if (!filteringRulesResult) {
            return true;
        }

        // If no filtering rules found, then the delegated actor does not have valid consent
        if (!filteringRulesResult.filteringRules) {
            return false;
        }

        return true;
    }
}

module.exports = {
    DelegatedActorScopeManager
};
