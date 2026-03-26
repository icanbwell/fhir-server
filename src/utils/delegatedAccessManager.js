const { ForbiddenError } = require('./httpErrors');
const { AUTH_USER_TYPES, DELEGATED_ACCESS } = require('../constants');
const { FhirRequestInfo } = require('./fhirRequestInfo');

const RESTRICTED_OPERATIONS = new Set(DELEGATED_ACCESS.RESTRICTED_OPERATIONS);

class DelegatedAccessManager {
    /**
     * Returns whether the given request is from a delegated access user
     * @param {FhirRequestInfo} requestInfo
     * @returns {boolean}
     */
    isDelegatedUser (requestInfo) {
        return requestInfo?.userType === AUTH_USER_TYPES.delegatedUser;
    }

    /**
     * Verifies that a delegated access user is not performing a restricted operation.
     * Throws ForbiddenError if access is denied.
     * @param {FhirRequestInfo} requestInfo
     * @param {string} resourceType
     * @param {string} operation
     */
    verifyAccess ({ requestInfo, resourceType, operation }) {
        if (!this.isDelegatedUser(requestInfo)) {
            return;
        }

        if (RESTRICTED_OPERATIONS.has(operation)) {
            throw new ForbiddenError(
                `Delegated access user does not have access to ${resourceType}.${operation}`
            );
        }
    }
}

module.exports = { DelegatedAccessManager };
