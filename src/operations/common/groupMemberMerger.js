const { mergeDuplicateMembers } = require('./groupMemberDedupe');
const { buildContextDataForHybridStorage } = require('../../utils/contextDataBuilder');

/**
 * Keeps one entry per member in an embedded Group's member[], on every write that stores one:
 * a POST and a PUT that creates the Group (CreateOperation, UpdateOperation), a PUT or $merge
 * combining the stored Group with the sent one (MergeManager.mergeExistingAsync merges the stored
 * Group's own repeated members first, then ResourceMerger the combined result), a $merge that
 * creates the Group, from one entry or several (MergeManager.mergeInsertAsync), and a PATCH
 * applied to the stored Group (PatchOperation). Entries of the same member are merged with
 * mergeDuplicateMembers, so a payload that lists a member twice is stored with one entry for it.
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
     * @param {Object} params.resource - run through preSave, so _sourceAssigningAuthority is set;
     *   its member[] is replaced when entries are merged
     * @param {import('../../utils/fhirRequestInfo').FhirRequestInfo} [params.requestInfo]
     * @param {{has: function(Object): boolean}} [params.olderEntries] - see mergeDuplicateMembers
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
