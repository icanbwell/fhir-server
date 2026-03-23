const { ForbiddenError, BadRequestError } = require('./httpErrors');
const { AUTH_USER_TYPES, CMS_PARTNER_ACCESS, PERSON_PROXY_PREFIX } = require('../constants');
const { ParsedArgs } = require('../operations/query/parsedArgs');
const { FhirRequestInfo } = require('./fhirRequestInfo');

class CMSManager {
    /**
     * Returns whether the given request is from a CMS partner user
     * @param {FhirRequestInfo} requestInfo
     * @returns {boolean}
     */
    isCmsPartnerUser(requestInfo) {
        return requestInfo?.userType === AUTH_USER_TYPES.cmsPartnerUser;
    }

    /**
     * Verifies that a CMS partner user has access to the given operation and resource type.
     * Throws ForbiddenError if access is denied.
     * @param {FhirRequestInfo} requestInfo
     * @param {string} resourceType
     * @param {string} operation
     */
    verifyAccess({ requestInfo, resourceType, operation }) {
        if (!this.isCmsPartnerUser(requestInfo)) {
            return;
        }

        const method = requestInfo.method?.toLowerCase();
        if (method && !CMS_PARTNER_ACCESS.ALLOWED_METHODS.includes(method)) {
            throw new ForbiddenError(
                `CMS partner user does not have access to ${method.toUpperCase()} method`
            );
        }

        if (!CMS_PARTNER_ACCESS.ALLOWED_OPERATIONS.includes(operation) ||
            !CMS_PARTNER_ACCESS.ALLOWED_RESOURCE_TYPES.includes(resourceType)) {
            throw new ForbiddenError(
                `CMS partner user does not have access to ${resourceType} ${operation}`
            );
        }
    }

    /**
     * Verifies CMS partner user is not using a proxy patient ID (person.{id}).
     * @param {FhirRequestInfo} requestInfo
     * @param {string} patientId
     */
    verifyNotProxyPatientId({ requestInfo, patientId }) {
        if (!this.isCmsPartnerUser(requestInfo)) {
            return;
        }

        const hasProxyPatientId = patientId &&
            patientId.split(',').some((id) => id.startsWith(PERSON_PROXY_PREFIX));

        if (hasProxyPatientId) {
            throw new ForbiddenError(
                'CMS partner user cannot use proxy patient ID in $everything'
            );
        }
    }

    /**
     * Strips restricted query args from parsedArgs for CMS partner users.
     * Args in CMS_PARTNER_ACCESS.RESTRICTED_EVERYTHING_PARAMS are removed.
     * @param {FhirRequestInfo} requestInfo
     * @param {ParsedArgs} parsedArgs
     */
    sanitizeEverythingParams({ requestInfo, parsedArgs }) {
        if (!this.isCmsPartnerUser(requestInfo)) {
            return;
        }

        const hasMultipleIds = Array.isArray(parsedArgs.id)
            ? parsedArgs.id.length > 1
            : parsedArgs.id?.includes(',');

        if (hasMultipleIds) {
            throw new BadRequestError(new Error('Multiple IDs are not allowed'));
        }

        for (const item of [...parsedArgs.parsedArgItems]) {
            if (CMS_PARTNER_ACCESS.RESTRICTED_EVERYTHING_PARAMS.includes(item.queryParameter)) {
                parsedArgs.remove(item.queryParameter);
                parsedArgs[item.queryParameter] = null;
            }
        }

    }
}

module.exports = { CMSManager };
