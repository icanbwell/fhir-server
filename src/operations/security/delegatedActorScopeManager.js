const {assertTypeEquals} = require('../../utils/assertType');
const {DelegatedActorRulesManager} = require('../../utils/delegatedActorRulesManager');

class DelegatedActorScopeManager {
    /**
     * @param {DelegatedActorRulesManager} delegatedActorRulesManager
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
     * @param {string} delegatedActor
     * @param {string} personIdFromJwtToken
     * @param {string} base_version
     * @param {string} accessRequested
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
