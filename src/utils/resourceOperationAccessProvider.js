const { MethodNotAllowedError } = require('./httpErrors');

const RESTRICTED_OPERATIONS = {
    AuditEvent: ['update', 'patch', 'remove', 'remove_by_query']
};

class ResourceOperationAccessProvider {
    /**
     * Rejects operations that are restricted for the given resource type.
     * @param {import('./fhirRequestInfo').FhirRequestInfo} requestInfo
     * @param {string} resourceType
     * @param {string} operation
     */
    verifyAccess ({ requestInfo, resourceType, operation }) {
        const blockedOps = RESTRICTED_OPERATIONS[resourceType];
        if (blockedOps && blockedOps.includes(operation)) {
            throw new MethodNotAllowedError(
                `This operation is not allowed on ${resourceType} resources`
            );
        }
    }
}

module.exports = { ResourceOperationAccessProvider };
