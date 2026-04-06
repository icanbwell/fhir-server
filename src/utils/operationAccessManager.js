/**
 * @typedef {Object} AccessProvider
 * @property {function({requestInfo: FhirRequestInfo, resourceType: string, operation: string}): void} verifyAccess
 */

class OperationAccessManager {
    /**
     * @param {Object} params
     * @param {AccessProvider[]} params.accessProviders
     */
    constructor ({ accessProviders }) {
        /**
         * @type {AccessProvider[]}
         */
        this.accessProviders = accessProviders;
    }

    /**
     * Runs all access provider checks for the given request.
     * Throws ForbiddenError if any provider denies access.
     * @param {import('./fhirRequestInfo').FhirRequestInfo} requestInfo
     * @param {string} resourceType
     * @param {string} operation
     */
    verifyAccess ({ requestInfo, resourceType, operation }) {
        for (const provider of this.accessProviders) {
            provider.verifyAccess({ requestInfo, resourceType, operation });
        }
    }
}

module.exports = { OperationAccessManager };
