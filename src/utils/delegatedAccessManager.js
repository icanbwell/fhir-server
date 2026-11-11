const { ForbiddenError } = require('./httpErrors');
const { AUTH_USER_TYPES, DELEGATED_ACCESS } = require('../constants');
const { FhirRequestInfo } = require('./fhirRequestInfo');
const { ReferenceParser } = require('./referenceParser');
const { ConfigManager } = require('./configManager');
const { assertTypeEquals } = require('./assertType');

const ALLOWED_OPERATIONS = new Set(DELEGATED_ACCESS.ALLOWED_OPERATIONS);

/**
 * Manages access control for delegated users.
 *
 * For REST endpoints, each operation in fhirOperationsManager calls verifyAccess() with its
 * operation name (e.g. 'search', 'create'). Only operations in DELEGATED_ACCESS.ALLOWED_OPERATIONS pass.
 *
 * For GraphQL:
 * - Queries go through the same searchManager as REST search, so they are implicitly
 *   allowed (no separate operation name exists for GraphQL queries).
 * - Mutations are blocked via verifyAccess() with operation 'mutation' in the GraphQL v1
 *   dataSource (getResourcesForMutation). GraphQL v2 has no mutations.
 */
class DelegatedAccessManager {
    /**
     * @param {Object} params
     * @param {ConfigManager} params.configManager
     */
    constructor ({ configManager }) {
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

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

        if (this.isOrganizationActor(requestInfo) &&
            !this.isOrganizationActorOperationAllowed({ resourceType, operation })) {
            throw new ForbiddenError(
                `Organization actor does not have access to ${resourceType} ${operation}`
            );
        }
    }

    /**
     * @param {Object} params
     * @param {string} params.resourceType
     * @param {string} params.operation
     * @returns {boolean}
     */
    isOrganizationActorOperationAllowed ({ resourceType, operation }) {
        const allowed = this.configManager.delegatedOrganizationActorAllowedOperations;
        return allowed.has(`${resourceType}:${operation}`) || allowed.has(`*:${operation}`);
    }

    /**
     * Returns whether the request is from a delegated user whose actor is an Organization
     * @param {FhirRequestInfo} requestInfo
     * @returns {boolean}
     */
    isOrganizationActor (requestInfo) {
        return this.isDelegatedUser(requestInfo) &&
            ReferenceParser.parseReference(requestInfo.actor?.reference).resourceType === 'Organization';
    }
}

module.exports = { DelegatedAccessManager };
