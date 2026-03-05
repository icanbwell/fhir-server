/**
 * Builds contextData for resources using hybrid storage (MongoDB metadata + ClickHouse arrays)
 * Currently supports: Group (extensible to List when needed)
 *
 * @param {string} resourceType - FHIR resource type
 * @param {Resource} resource - FHIR resource document
 * @returns {Object|null} contextData object or null if not a hybrid storage resource
 */
function buildContextDataForHybridStorage(resourceType, resource) {
    if (resourceType === 'Group') {
        return {
            groupMembers: resource.member || [],
            resourceType,
            resourceId: resource.id
        };
    }

    // List resources with entry arrays will follow the same pattern

    return null;
}

module.exports = {
    buildContextDataForHybridStorage
};
