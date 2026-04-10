const { BasePostSaveHandler } = require('../../utils/basePostSaveHandler');
const { logInfo, logError, logDebug } = require('../../operations/common/logging');
const { RethrownError } = require('../../utils/rethrownError');
const { OPERATION_TYPES, EVENT_TYPES } = require('../../constants/clickHouseConstants');
const { GroupMemberEventBuilder } = require('../builders/groupMemberEventBuilder');
const { GroupMemberDiffComputer } = require('../../domain/group/groupMemberDiffComputer');

/**
 * Post-save handler for MongoDB Group member event tracking
 *
 * Mirrors ClickHouseGroupHandler — same interface, same flow, but writes to
 * MongoDB event collection (Group_4_0_0_MemberEvent) instead of ClickHouse.
 *
 * Activation: Only processes when contextData.useMongoGroupMembers === true
 * (set when header subGroupMemberRequest: true is present).
 * When the flag is absent/false, this handler returns early and lets
 * ClickHouseGroupHandler process instead.
 */
class MongoGroupMemberHandler extends BasePostSaveHandler {
    /**
     * @param {Object} params
     * @param {import('../../utils/configManager').ConfigManager} params.configManager
     * @param {import('../repositories/mongoGroupMemberRepository').MongoGroupMemberRepository} params.mongoGroupMemberRepository
     */
    constructor({ configManager, mongoGroupMemberRepository }) {
        super();
        this.configManager = configManager;
        this.repository = mongoGroupMemberRepository;
    }

    /**
     * Declares resource types this handler processes
     * @return {string[]}
     */
    getHandledResourceTypes() {
        return ['Group'];
    }

    /**
     * Checks if handler should process this resource
     * @param {string} resourceType
     * @return {boolean}
     */
    canHandle(resourceType) {
        return this.getHandledResourceTypes().includes(resourceType) &&
               this.configManager.enableMongoGroupMembers;
    }

    /**
     * Groups always use synchronous writes for read-after-write consistency
     * @param {string} resourceType
     * @return {boolean}
     */
    shouldBlockForResource(resourceType) {
        return this.canHandle(resourceType);
    }

    /**
     * Processes Group save events, writing member changes to MongoDB event collection
     *
     * @param {Object} params
     * @param {string} params.requestId
     * @param {string} params.eventType - OPERATION_TYPES.CREATE, UPDATE, or DELETE
     * @param {string} params.resourceType
     * @param {Object} params.doc - FHIR Group resource
     * @param {Object|null} params.contextData
     * @return {Promise<void>}
     */
    async afterSaveAsync({ requestId, eventType, resourceType, doc, contextData = null }) {
        if (!this.canHandle(resourceType)) {
            return;
        }

        // Only process when request explicitly activated MongoDB group members
        if (!contextData?.useMongoGroupMembers) {
            return;
        }

        try {
            // Skip if PATCH already wrote events directly
            if (contextData?.groupMemberEventsWritten) {
                logDebug('POST-save: Member events already written (PATCH), skipping', {
                    groupId: doc.id,
                    eventType
                });
                return;
            }

            const originalMembers = contextData?.groupMembers || [];

            logDebug('POST-save [MongoDB]: Processing Group', {
                groupId: doc.id,
                eventType,
                originalMemberCount: originalMembers.length
            });

            // DELETE: preserve events as immutable audit trail (same as ClickHouse handler)
            if (eventType === OPERATION_TYPES.DELETE) {
                logDebug('Group deleted - MongoDB member events retained for audit', {
                    groupId: doc.id
                });
                return;
            }

            // CREATE: write all members as 'added' events
            if (eventType === OPERATION_TYPES.CREATE) {
                if (!originalMembers || originalMembers.length === 0) {
                    logDebug('No members to write for CREATE', { groupId: doc.id });
                    return;
                }
                const docWithMembers = { ...doc, member: originalMembers };
                await this._writeMemberEventsIfNeeded(
                    originalMembers,
                    EVENT_TYPES.MEMBER_ADDED,
                    docWithMembers
                );

                logInfo('MongoDB CREATE events written', {
                    groupId: doc.id,
                    memberCount: originalMembers.length
                });
                return;
            }

            // UPDATE: compute diff and write events
            if (eventType === OPERATION_TYPES.UPDATE) {
                const docWithMembers = { ...doc, member: originalMembers };
                await this._handleUpdateAsync(docWithMembers);

                logInfo('MongoDB UPDATE events written', { groupId: doc.id });
            }
        } catch (error) {
            logError('MongoDB POST-save handler error', {
                error: error.message,
                groupId: doc.id,
                resourceType,
                eventType
            });

            // Propagate error — same rationale as ClickHouse handler:
            // MongoDB metadata is already committed, client should see 500
            // so they know the member write failed
            throw new RethrownError({
                message: 'Failed to write Group member events to MongoDB event collection',
                error,
                args: { groupId: doc.id, resourceType, eventType }
            });
        }
    }

    /**
     * Writes member events if the member array is non-empty
     * @private
     */
    async _writeMemberEventsIfNeeded(members, eventType, groupResource) {
        if (!members || members.length === 0) {
            return;
        }
        return this._appendMemberEventsAsync(groupResource, eventType, members);
    }

    /**
     * Builds and writes combined events for additions and removals
     * @private
     */
    async _writeCombinedEventsAsync({ groupId, additions, removals, groupResource }) {
        const allEvents = [];

        if (additions.length > 0) {
            const addEvents = GroupMemberEventBuilder.buildEvents({
                groupId,
                members: additions,
                eventType: EVENT_TYPES.MEMBER_ADDED,
                groupResource
            });
            allEvents.push(...addEvents);
        }

        if (removals.length > 0) {
            const removeEvents = GroupMemberEventBuilder.buildEvents({
                groupId,
                members: removals,
                eventType: EVENT_TYPES.MEMBER_REMOVED,
                groupResource
            });
            allEvents.push(...removeEvents);
        }

        if (allEvents.length > 0) {
            await this.repository.appendEvents(allEvents);
        }
    }

    /**
     * Builds and appends member events
     * @private
     */
    async _appendMemberEventsAsync(groupResource, eventType, members) {
        try {
            const events = GroupMemberEventBuilder.buildEvents({
                groupId: groupResource.id,
                members,
                eventType,
                groupResource
            });

            await this.repository.appendEvents(events);

            logInfo('Appended member events to MongoDB', {
                groupId: groupResource.id,
                eventType,
                count: events.length
            });
        } catch (error) {
            throw new RethrownError({
                message: 'Error appending Group member events to MongoDB',
                error,
                args: { groupId: groupResource.id, eventType, memberCount: members.length }
            });
        }
    }

    /**
     * Gets current member references from the MongoDB view
     * @private
     */
    async _getCurrentMembers(groupId) {
        const references = await this.repository.getActiveMembers(groupId);
        return new Set(references);
    }

    /**
     * Handles Group update by computing diff between current and new members
     * @private
     */
    async _handleUpdateAsync(groupResource) {
        try {
            const currentReferences = await this._getCurrentMembers(groupResource.id);

            const { additions, removals } = GroupMemberDiffComputer.compute(
                currentReferences,
                groupResource.member
            );

            const currentCount = currentReferences.size;
            const finalCount = currentCount + additions.length - removals.length;

            logDebug('Computed member diff [MongoDB]', {
                groupId: groupResource.id,
                additions: additions.length,
                removals: removals.length,
                current: currentCount,
                finalCount
            });

            await this._writeCombinedEventsAsync({
                groupId: groupResource.id,
                additions,
                removals,
                groupResource
            });

            logInfo('Processed Group update [MongoDB]', {
                groupId: groupResource.id,
                added: additions.length,
                removed: removals.length,
                finalCount
            });

            return { added: additions.length, removed: removals.length, finalCount };
        } catch (error) {
            throw new RethrownError({
                message: 'Error handling Group update in MongoDB',
                error,
                args: { groupId: groupResource.id }
            });
        }
    }

    /**
     * Writes Group member events to MongoDB (for PATCH operations)
     *
     * Called by PATCH operation handler with pre-computed member diffs.
     * Same interface as ClickHouseGroupHandler.writeEventsAsync().
     *
     * @param {Object} params
     * @param {string} params.groupId - Group resource ID
     * @param {Array<Object>} params.added - Members to add
     * @param {Array<Object>} params.removed - Members to remove
     * @param {Object} params.groupResource - Full Group resource
     * @returns {Promise<void>}
     */
    async writeEventsAsync({ groupId, added = [], removed = [], groupResource }) {
        try {
            logDebug('Writing Group member events directly [MongoDB]', {
                groupId,
                addedCount: added.length,
                removedCount: removed.length
            });

            if (!groupResource) {
                throw new Error(`groupResource is required for writeEventsAsync (groupId: ${groupId})`);
            }

            await this._writeCombinedEventsAsync({
                groupId,
                additions: added,
                removals: removed,
                groupResource
            });

            logInfo('Successfully wrote Group member events [MongoDB]', {
                groupId,
                addedCount: added.length,
                removedCount: removed.length
            });
        } catch (error) {
            throw new RethrownError({
                message: 'Error writing Group member events to MongoDB',
                error,
                args: { groupId, addedCount: added.length, removedCount: removed.length }
            });
        }
    }
}

module.exports = { MongoGroupMemberHandler };
