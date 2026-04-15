const { isTrue } = require('./isTrue');

/**
 * Header name for activating external storage (ClickHouse).
 * When present and truthy, array fields (e.g. Group.member) are tracked in ClickHouse.
 * When absent, standard FHIR behavior applies (stored inline in MongoDB).
 *
 * This constant is the SINGLE source of truth for the header name.
 * Import it everywhere the header is checked — never hardcode the string.
 *
 * NOTE: Express lowercases all incoming header names.
 */
const USE_EXTERNAL_STORAGE_HEADER = 'useexternalstorage';

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
        const useExternalStorage = isTrue(requestInfo?.headers?.[USE_EXTERNAL_STORAGE_HEADER]);

        return {
            groupMembers: resource.member || [],
            resourceType,
            resourceId: resource.id,
            useExternalStorage,
            smartMerge: smartMerge ?? undefined
        };
    }

    // List resources with entry arrays will follow the same pattern

    return null;
}

module.exports = {
    buildContextDataForHybridStorage,
    USE_EXTERNAL_STORAGE_HEADER
};
