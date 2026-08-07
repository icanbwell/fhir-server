const {assertTypeEquals} = require('../../utils/assertType');
const {DelegatedAccessRulesManager} = require('../../utils/delegatedAccessRulesManager');

class DelegatedAccessScopeManager {
    /**
     * @param {Object} params
     * @param {DelegatedAccessRulesManager} params.delegatedAccessRulesManager
     */
    constructor({delegatedAccessRulesManager}) {
        /**
         * @type {DelegatedAccessRulesManager}
         */
        this.delegatedAccessRulesManager = delegatedAccessRulesManager;
        assertTypeEquals(delegatedAccessRulesManager, DelegatedAccessRulesManager);
    }

    /**
     * Checks if the delegated actor has valid access
     * @param {Object} params
     * @param {import('../../utils/fhirRequestInfo').JwtActor} params.actor
     * @param {string} params.personIdFromJwtToken
     * @param {string} [params.base_version] the FHIR version of the resource being requested
     * @returns {Promise<boolean>}
     */
    async isAccessAllowedAsync({actor, personIdFromJwtToken, base_version}) {
        if (!actor || !personIdFromJwtToken) {
            return false;
        }
        return await this.delegatedAccessRulesManager.hasValidConsentAsync({
            actor,
            personIdFromJwtToken,
            base_version
        });
    }
}

module.exports = {
    DelegatedAccessScopeManager
};
