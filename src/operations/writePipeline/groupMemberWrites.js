/**
 * The rules for a write that carries Group members, in one place for the build, attachments and
 * write steps.
 */

/**
 * Returns whether the resource is a Group with a non-empty `member` array.
 * @param {Object} resource
 * @returns {boolean}
 */
function hasGroupMembers (resource) {
    return resource.resourceType === 'Group' &&
        Array.isArray(resource.member) &&
        resource.member.length > 0;
}

/**
 * Returns whether members of the resource type are written to ClickHouse: ClickHouse is on and the
 * type is one of `mongoWithClickHouseResources`.
 * @param {string} resourceType
 * @param {import('../../utils/configManager').ConfigManager} configManager
 * @returns {boolean}
 */
function storesMembersInClickHouse ({ resourceType, configManager }) {
    return configManager.enableClickHouse &&
        configManager.mongoWithClickHouseResources.includes(resourceType);
}

/**
 * Returns whether the item's write also writes Group members to ClickHouse: the request asked for
 * external storage, the body carries `member` (an empty list counts, it removes them all), and
 * members of the item's resource type are written to ClickHouse. These members are not in the
 * stored document, so a versioned write that loses a race and whose replay finds the document
 * unchanged would be skipped together with its member write.
 * @param {import('./writeItem').WriteItem} item
 * @param {import('../../utils/configManager').ConfigManager} configManager
 * @returns {boolean}
 */
function writesClickHouseMembers ({ item, configManager }) {
    const contextData = item.contextData;
    return contextData?.useExternalStorage === true &&
        contextData.groupMembers !== undefined &&
        storesMembersInClickHouse({ resourceType: item.candidate.resourceType, configManager });
}

/**
 * Returns the members that have an entity reference the stored members don't have.
 * @param {Object[]|undefined} members
 * @param {Object[]} storedMembers
 * @returns {Object[]}
 */
function membersNotStored ({ members, storedMembers }) {
    const storedReferences = new Set(
        storedMembers.map((member) => member.entity?.reference).filter(Boolean)
    );
    return (members || []).filter(
        (member) => member.entity?.reference && !storedReferences.has(member.entity.reference)
    );
}

module.exports = {
    hasGroupMembers,
    storesMembersInClickHouse,
    writesClickHouseMembers,
    membersNotStored
};
