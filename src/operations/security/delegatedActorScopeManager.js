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
     * @param {import('../../utils/fhirRequestInfo').JwtActor} params.actor
     * @param {string} params.personIdFromJwtToken
     * @param {string} params.base_version
     * @param {string} params.accessRequested
     * @returns {Promise<boolean>}
     */
    async isAccessAllowedAsync({actor, personIdFromJwtToken, base_version}) {
        return await this.delegatedActorRulesManager.hasValidConsentAsync({
            actor,
            personIdFromJwtToken,
            base_version
        });
    }
}

module.exports = {
    DelegatedActorScopeManager
};
