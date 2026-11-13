const { mergeDuplicateMembers } = require('./groupMemberDedupe');
const { buildContextDataForHybridStorage } = require('../../utils/contextDataBuilder');

/**
 * Keeps one entry per member in an embedded Group's member[] where a write combines entries:
 * a $merge combining the stored Group with the sent one (MergeManager.mergeExistingAsync merges
 * the stored Group's own repeated members first, then ResourceMerger the combined result), two
 * $merge entries for one new Group (MergeManager.mergeInsertAsync), and a PATCH applied to the
 * stored Group (PatchOperation). Entries of the same member are merged with mergeDuplicateMembers. A Group
 * that lists a member twice in a POST, PUT or $merge entry is rejected before it gets here
 * (ResourceValidator.validateGroupMembersUniqueSync).
 *
 * A write that sends its members to ClickHouse is left as it is: that path tracks members by
 * entity.reference string and diffs member[] itself. A write sends members to ClickHouse under the
 * same two conditions the write path uses: buildContextDataForHybridStorage's useExternalStorage
 * (the useexternalstorage header on a Group that is not extended), and ClickHouse enabled for
 * Group (PostSaveHandlerFactory, ClickHouseGroupHandler.canHandle). An extended Group keeps its
 * members in GroupMember_4_0_0 whatever the header says, so the header does not stop the merge
 * there.
 */
class GroupMemberMerger {
    /**
     * @param {Object} params
     * @param {import('../../utils/configManager').ConfigManager} params.configManager
     */
    constructor({ configManager }) {
        this.configManager = configManager;
    }

    /**
     * @param {Object} params
     * @param {Object} params.resource - its member[] is replaced when entries are merged
     * @param {import('../../utils/fhirRequestInfo').FhirRequestInfo} [params.requestInfo]
     * @param {Set<Object>} [params.olderEntries] - see mergeDuplicateMembers
     * @returns {Object} resource
     */
    mergeMembers({ resource, requestInfo, olderEntries }) {
        if (
            resource?.resourceType !== 'Group' ||
            !Array.isArray(resource.member) ||
            this.sendsMembersToClickHouse({ resource, requestInfo })
        ) {
            return resource;
        }
        resource.member = mergeDuplicateMembers({
            members: resource.member,
            sourceAssigningAuthority: resource._sourceAssigningAuthority,
            olderEntries,
            groupId: resource.id
        });
        return resource;
    }

    /**
     * @param {Object} params
     * @param {Object} params.resource - a Group
     * @param {import('../../utils/fhirRequestInfo').FhirRequestInfo} [params.requestInfo]
     * @returns {boolean}
     */
    sendsMembersToClickHouse({ resource, requestInfo }) {
        return (
            buildContextDataForHybridStorage(resource.resourceType, resource, requestInfo)?.useExternalStorage === true &&
            this.configManager.enableClickHouse &&
            this.configManager.mongoWithClickHouseResources.includes(resource.resourceType)
        );
    }
}

module.exports = {
    GroupMemberMerger
};
