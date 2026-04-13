const { HEADERS } = require('../constants/mongoGroupMemberConstants');

/**
 * Builds contextData for resources using hybrid storage (MongoDB metadata + ClickHouse arrays)
 * Currently supports: Group (extensible to List when needed)
 *
 * @param {string} resourceType - FHIR resource type
 * @param {Resource} resource - FHIR resource document
 * @param {import('./fhirRequestInfo').FhirRequestInfo|null} [requestInfo=null] - Request info for header checks
 * @param {import('./configManager').ConfigManager|null} [configManager=null] - Config manager for feature flags
 * @returns {Object|null} contextData object or null if not a hybrid storage resource
 */
function buildContextDataForHybridStorage(resourceType, resource, requestInfo = null, configManager = null) {
    if (resourceType === 'Group') {
        const contextData = {
            groupMembers: resource.member || [],
            resourceType,
            resourceId: resource.id
        };
        // Set flag for MongoDB group member flow when BOTH conditions are true:
        // 1. Global: ENABLE_MONGO_GROUP_MEMBERS=1 (env var via configManager)
        // 2. Per-request: header subGroupMemberRequest: true
        // Without the header, the Group is written/read as a normal FHIR resource.
        if (configManager && configManager.enableMongoGroupMembers &&
            requestInfo?.headers?.[HEADERS.SUB_GROUP_MEMBER_REQUEST] === 'true') {
            contextData.useMongoGroupMembers = true;
        }
        // Set flag for MongoDB Direct group member flow (V2 - no event sourcing)
        // Requires BOTH: ENABLE_MONGO_DIRECT_GROUP_MEMBERS=1 AND header directGroupMemberRequest: true
        if (configManager && configManager.enableMongoDirectGroupMembers &&
            requestInfo?.headers?.[HEADERS.DIRECT_GROUP_MEMBER_REQUEST] === 'true') {
            contextData.useMongoDirectGroupMembers = true;
        }
        return contextData;
    }

    // List resources with entry arrays will follow the same pattern

    return null;
}

module.exports = {
    buildContextDataForHybridStorage
};
