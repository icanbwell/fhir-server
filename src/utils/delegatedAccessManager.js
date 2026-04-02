const { ForbiddenError } = require('./httpErrors');
const { AUTH_USER_TYPES, DELEGATED_ACCESS } = require('../constants');
const { FhirRequestInfo } = require('./fhirRequestInfo');

const ALLOWED_OPERATIONS = new Set(DELEGATED_ACCESS.ALLOWED_OPERATIONS);

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
     * Verifies that a delegated access user is only performing read operations.
     * Throws ForbiddenError if access is denied.
     * @param {FhirRequestInfo} requestInfo
     * @param {string} resourceType
     * @param {string} operation
     */
    verifyAccess ({ requestInfo, resourceType, operation }) {
        if (!this.isDelegatedUser(requestInfo)) {
            return;
        }

        if (!ALLOWED_OPERATIONS.has(operation)) {
            throw new ForbiddenError(
                `User does not have access to ${operation.toUpperCase()} method`
            );
        }
    }
}

module.exports = { DelegatedAccessManager };
