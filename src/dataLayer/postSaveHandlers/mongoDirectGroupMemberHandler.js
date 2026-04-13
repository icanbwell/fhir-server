'use strict';

const { BasePostSaveHandler } = require('../../utils/basePostSaveHandler');
const { logInfo, logDebug, logError } = require('../../operations/common/logging');
const { RethrownError } = require('../../utils/rethrownError');

/**
 * Post-save handler for MongoDB Direct Group Member storage (V2)
 *
 * Architecture: Current-state-only collection with upsert/delete
 * - No event sourcing (unlike V1 MongoGroupMemberHandler)
 * - No member validation (like ClickHouse)
 * - No ObjectId resolution (stores string references)
 * - Computes diff on UPDATE to minimize writes
 *
 * TODO: Add history tracking for member changes following existing
 * resource history implementation pattern (separate history collection)
 */
class MongoDirectGroupMemberHandler extends BasePostSaveHandler {
    /**
     * @param {Object} params
     * @param {import('../../utils/configManager').ConfigManager} params.configManager
     * @param {import('../repositories/mongoDirectGroupMemberRepository').MongoDirectGroupMemberRepository} params.mongoDirectGroupMemberRepository
     */
    constructor({ configManager, mongoDirectGroupMemberRepository }) {
        super();
        this.configManager = configManager;
        this.repository = mongoDirectGroupMemberRepository;
    }

    getHandledResourceTypes() {
        return ['Group'];
    }

    canHandle(resourceType) {
        return this.getHandledResourceTypes().includes(resourceType) &&
               this.configManager.enableMongoDirectGroupMembers;
    }

    shouldBlockForResource(resourceType) {
        return this.canHandle(resourceType);
    }

    /**
     * @param {Object} params
     * @param {string} params.requestId
     * @param {string} params.eventType
     * @param {string} params.resourceType
     * @param {Object} params.doc
     * @param {Object|null} params.contextData
     */
    async afterSaveAsync({ requestId, eventType, resourceType, doc, contextData = null }) {
        if (!this.canHandle(resourceType)) {
            return;
        }

        if (!contextData?.useMongoDirectGroupMembers) {
            return;
        }

        // Skip if events already written by PATCH
        if (contextData?.groupMemberEventsWritten) {
            logDebug('POST-save: Member events already written by PATCH, skipping', {
                groupId: doc.id
            });
            return;
        }

        const groupUuid = doc._uuid;
        const originalMembers = contextData?.groupMembers || [];

        try {
            if (eventType === 'C') {
                // CREATE: upsert all members
                if (originalMembers.length > 0) {
                    await this.repository.upsertMembersAsync({
                        groupUuid,
                        members: originalMembers
                    });
                    logInfo('Direct members written (CREATE)', {
                        groupId: doc.id,
                        count: originalMembers.length
                    });
                }
                return;
            }

            if (eventType === 'U') {
                // UPDATE: compute diff and apply
                await this.repository.replaceMembersAsync({
                    groupUuid,
                    members: originalMembers
                });
                logInfo('Direct members replaced (UPDATE)', {
                    groupId: doc.id,
                    incomingCount: originalMembers.length
                });
                return;
            }

            if (eventType === 'D') {
                // DELETE: preserve member data (like ClickHouse behavior)
                // TODO: Consider deleting members on Group deletion if history is implemented
                logDebug('Group deleted - direct members retained', {
                    groupId: doc.id
                });
            }
        } catch (error) {
            throw new RethrownError({
                message: 'Failed to write direct Group member data',
                error,
                args: { groupId: doc.id, eventType }
            });
        }
    }

    /**
     * Writes member events for PATCH operations (called directly by groupMemberPatchStrategy)
     *
     * @param {Object} params
     * @param {string} params.groupId
     * @param {Array<Object>} params.added
     * @param {Array<Object>} params.removed
     * @param {Object} params.groupResource
     */
    async writeEventsAsync({ groupId, added = [], removed = [], groupResource }) {
        const groupUuid = groupResource._uuid;
        const startTime = Date.now();

        try {
            if (added.length > 0) {
                await this.repository.upsertMembersAsync({
                    groupUuid,
                    members: added
                });
            }

            if (removed.length > 0) {
                await this.repository.removeMembersAsync({
                    groupUuid,
                    members: removed
                });
            }

            logInfo('Direct member PATCH events written', {
                groupId,
                added: added.length,
                removed: removed.length,
                duration_ms: Date.now() - startTime
            });
        } catch (error) {
            throw new RethrownError({
                message: 'Error writing direct Group member PATCH events',
                error,
                args: { groupId, addedCount: added.length, removedCount: removed.length }
            });
        }
    }
}

module.exports = { MongoDirectGroupMemberHandler };
