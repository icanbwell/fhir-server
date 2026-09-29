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

    /**
     * DCON-4846: same allowlist check as verifyAccess, for GraphQL read (query) call sites.
     * GraphQL has no GET/POST read/write split -- every request, including a pure query, is
     * transported over HTTP POST. CMSManager.verifyAccess gates on requestInfo.method against an
     * allowlist of HTTP verbs (currently just 'get'), which is meaningful for REST but would reject
     * every CMS-partner GraphQL query outright if requestInfo.method were passed through unchanged.
     * A GraphQL query is semantically a read, the same as a REST GET, so the method is overridden
     * to 'GET' here before delegating -- the resourceType/operation allowlist itself still applies.
     * @param {import('./fhirRequestInfo').FhirRequestInfo} requestInfo
     * @param {string} resourceType
     * @param {string} operation
     */
    verifyGraphQLReadAccess ({ requestInfo, resourceType, operation }) {
        const requestInfoAsRead = Object.assign(
            Object.create(Object.getPrototypeOf(requestInfo)),
            requestInfo,
            { method: 'GET' }
        );
        this.verifyAccess({ requestInfo: requestInfoAsRead, resourceType, operation });
    }
}

module.exports = { OperationAccessManager };
