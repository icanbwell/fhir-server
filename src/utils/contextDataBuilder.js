const { HEADERS } = require('../constants/mongoGroupMemberConstants');

/**
 * Builds contextData for resources using hybrid storage (MongoDB metadata + ClickHouse arrays)
 * Currently supports: Group (extensible to List when needed)
 *
 * @param {string} resourceType - FHIR resource type
 * @param {Resource} resource - FHIR resource document
 * @param {import('./fhirRequestInfo').FhirRequestInfo|null} [requestInfo=null] - Request info for header-based activation
 * @returns {Object|null} contextData object or null if not a hybrid storage resource
 */
function buildContextDataForHybridStorage(resourceType, resource, requestInfo = null) {
    if (resourceType === 'Group') {
        const contextData = {
            groupMembers: resource.member || [],
            resourceType,
            resourceId: resource.id
        };
        // Set flag for MongoDB group member flow if header is present
        if (requestInfo?.headers?.[HEADERS.SUB_GROUP_MEMBER_REQUEST] === 'true') {
            contextData.useMongoGroupMembers = true;
        }
        return contextData;
    }

    // List resources with entry arrays will follow the same pattern

    return null;
}

module.exports = {
    buildContextDataForHybridStorage
};
