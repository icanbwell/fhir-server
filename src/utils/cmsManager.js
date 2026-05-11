const { ForbiddenError, BadRequestError } = require('./httpErrors');
const { AUTH_USER_TYPES, CMS_PARTNER_ACCESS, PERSON_PROXY_PREFIX } = require('../constants');
const { ParsedArgs } = require('../operations/query/parsedArgs');
const { FhirRequestInfo } = require('./fhirRequestInfo');
const { logWarn } = require('../operations/common/logging');

class CMSManager {
    /**
     * @param {Object} params
     * @param {import('./configManager').ConfigManager} params.configManager
     */
    constructor({ configManager } = {}) {
        /**
         * @type {import('./configManager').ConfigManager}
         */
        this.configManager = configManager;
    }

    /**
     * Returns whether the given request is from a CMS partner user
     * @param {FhirRequestInfo} requestInfo
     * @returns {boolean}
     */
    isCmsPartnerUser(requestInfo) {
        return requestInfo?.userType === AUTH_USER_TYPES.cmsPartnerUser;
    }

    /**
     * Validates CMS partner user's JWT entitlements claim against the env allowlist.
     * Throws ForbiddenError on any failure; external message is uniform.
     * @param {import('./fhirRequestInfo').FhirRequestInfo} requestInfo
     * @private
     */
    _verifyEntitlements(requestInfo) {
        const allowed = this.configManager.cmsAllowedEntitlements;
        const claim = requestInfo.purposeOfEvent;

        const rejected =
            allowed.size === 0 ||
            !Array.isArray(claim) ||
            claim.length === 0 ||
            claim.some(code => !allowed.has(code));

        if (!rejected) return;

        logWarn('CMS partner user entitlement rejected', {
            user: requestInfo.user,
            requestId: requestInfo.requestId,
            args: { entitlements: claim }
        });
        throw new ForbiddenError('User does not have valid permission');
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

        this._verifyEntitlements(requestInfo);

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
     * Sanitizes $everything parameters for CMS partner users. Currently only allows a single patient ID
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
    }
}

module.exports = { CMSManager };
