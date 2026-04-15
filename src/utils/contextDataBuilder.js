const { isTrue } = require('./isTrue');

/**
 * Header name for activating external member storage (ClickHouse).
 * When present and truthy, Group member data is stored in ClickHouse.
 * When absent, standard FHIR behavior applies (members stored inline in MongoDB).
 *
 * This constant is the SINGLE source of truth for the header name.
 * Import it everywhere the header is checked — never hardcode the string.
 *
 * NOTE: Express lowercases all incoming header names.
 */
const USE_EXTERNAL_MEMBER_STORAGE_HEADER = 'useexternalmemberstorage';

/**
 * Builds contextData for resources using hybrid storage (MongoDB metadata + ClickHouse arrays)
 *
 * @param {string} resourceType - FHIR resource type
 * @param {Resource} resource - FHIR resource document
 * @param {FhirRequestInfo|null} [requestInfo] - Request info with headers
 * @param {Object} [options] - Additional options
 * @param {boolean} [options.smartMerge] - Whether this is a smartMerge operation (additions only, no removals)
 * @returns {Object|null} contextData object or null if not a hybrid storage resource
 */
function buildContextDataForHybridStorage(resourceType, resource, requestInfo = null, { smartMerge } = {}) {
    if (resourceType === 'Group') {
        const useExternalMemberStorage = isTrue(requestInfo?.headers?.[USE_EXTERNAL_MEMBER_STORAGE_HEADER]);

        return {
            groupMembers: resource.member || [],
            resourceType,
            resourceId: resource.id,
            useExternalMemberStorage,
            smartMerge: smartMerge ?? undefined
        };
    }

    // List resources with entry arrays will follow the same pattern

    return null;
}

module.exports = {
    buildContextDataForHybridStorage,
    USE_EXTERNAL_MEMBER_STORAGE_HEADER
};
