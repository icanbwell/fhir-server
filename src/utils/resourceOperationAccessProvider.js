const { MethodNotAllowedError } = require('./httpErrors');

const RESTRICTED_OPERATIONS = new Map([
    ['AuditEvent', new Set(['update', 'patch', 'remove', 'remove_by_query'])]
]);

class ResourceOperationAccessProvider {
    /**
     * Rejects operations that are restricted for the given resource type.
     * @param {import('./fhirRequestInfo').FhirRequestInfo} requestInfo
     * @param {string} resourceType
     * @param {string} operation
     */
    verifyAccess ({ requestInfo, resourceType, operation }) {
        const blockedOps = RESTRICTED_OPERATIONS.get(resourceType);
        if (blockedOps && blockedOps.has(operation)) {
            throw new MethodNotAllowedError(
                `This operation is not allowed on ${resourceType} resources`
            );
        }
    }
}

module.exports = { ResourceOperationAccessProvider };
