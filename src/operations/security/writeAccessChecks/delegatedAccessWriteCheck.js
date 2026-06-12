const { assertTypeEquals } = require('../../../utils/assertType');
const { DelegatedAccessRulesManager } = require('../../../utils/delegatedAccessRulesManager');
const { ForbiddenError } = require('../../../utils/httpErrors');
const { SENSITIVE_CATEGORY, AUTH_USER_TYPES } = require('../../../constants');
const { WriteAccessCheck } = require('./writeAccessCheck');

/**
 * Write-access check for delegated users, based on their consent rules.
 */
class DelegatedAccessWriteCheck extends WriteAccessCheck {
    /**
     * @param {Object} params
     * @param {DelegatedAccessRulesManager} params.delegatedAccessRulesManager
     */
    constructor ({ delegatedAccessRulesManager }) {
        super();
        /**
         * @type {DelegatedAccessRulesManager}
         */
        this.delegatedAccessRulesManager = delegatedAccessRulesManager;
        assertTypeEquals(delegatedAccessRulesManager, DelegatedAccessRulesManager);
    }

    /**
     * Throws ForbiddenError if a delegated user may not write this resource per consent.
     * Returns true (allows) for non-delegated requests or permitted writes.
     * @param {Object} params
     * @param {import('../../../utils/fhirRequestInfo').FhirRequestInfo} params.requestInfo
     * @param {Object} params.resource post-preSave resource (sensitivity tags populated)
     * @param {string} [params.base_version]
     * @returns {Promise<boolean>}
     */
    async checkAsync ({ requestInfo, resource, base_version = '4_0_0' }) {
        // Not a delegated write → this check does not apply
        if (requestInfo.userType !== AUTH_USER_TYPES.delegatedUser) {
            return true;
        }

        const forbiddenError = new ForbiddenError(
            `User does not have permission to write ${resource.resourceType}/${resource.id}`
        );
        const { filteringRules } = await this.delegatedAccessRulesManager.getFilteringRulesAsync({
            actor: requestInfo.actor,
            personIdFromJwtToken: requestInfo.personIdFromJwtToken,
            base_version
        });

        if (filteringRules === null) {
            // No valid consent found for the delegate → deny
            throw forbiddenError;
        }

        const deniedCategories = new Set(filteringRules.deniedSensitiveCategories || []);
        const resourceHasDeniedCategory = (resource.meta?.security || []).some(
            (s) => s.system === SENSITIVE_CATEGORY.SYSTEM && deniedCategories.has(s.code)
        );
        if (resourceHasDeniedCategory) {
            throw forbiddenError;
        }
        return true;
    }
}

module.exports = {
    DelegatedAccessWriteCheck
};
