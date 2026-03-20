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
     * @returns {Promise<{isAllowed: boolean, consentPolicy: string|null}>}
     */
    async isAccessAllowedAsync({actor, personIdFromJwtToken}) {
        return await this.delegatedAccessRulesManager.hasValidConsentAsync({
            actor,
            personIdFromJwtToken
        });
    }
}

module.exports = {
    DelegatedAccessScopeManager
};
