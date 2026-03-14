const {assertTypeEquals} = require('../../utils/assertType');
const {DelegatedActorRulesManager} = require('../../utils/delegatedActorRulesManager');

class DelegatedActorScopeManager {
    /**
     * @param {Object} params
     * @param {DelegatedActorRulesManager} params.delegatedActorRulesManager
     */
    constructor({delegatedActorRulesManager}) {
        /**
         * @type {DelegatedActorRulesManager}
         */
        this.delegatedActorRulesManager = delegatedActorRulesManager;
        assertTypeEquals(delegatedActorRulesManager, DelegatedActorRulesManager);
    }

    /**
     * Checks if the delegated actor has valid access
     * @param {Object} params
     * @param {string | null} params.delegatedActor
     * @param {string} params.personIdFromJwtToken
     * @param {string} params.base_version
     * @param {string} params.accessRequested
     * @returns {Promise<boolean>}
     */
    async isAccessAllowedAsync({delegatedActor, personIdFromJwtToken, base_version}) {
        if (!this.delegatedActorRulesManager.isUserDelegatedActor({delegatedActor})) {
            return true;
        }

        return await this.delegatedActorRulesManager.hasValidConsentAsync({
            delegatedActor,
            personIdFromJwtToken,
            base_version
        });
    }
}

module.exports = {
    DelegatedActorScopeManager
};
