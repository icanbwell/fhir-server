const { BasePostSaveHandler } = require('../../utils/basePostSaveHandler');
const { logInfo, logError, logDebug } = require('../../operations/common/logging');
const { RethrownError } = require('../../utils/rethrownError');
const { OPERATION_TYPES, EVENT_TYPES } = require('../../constants/clickHouseConstants');
const { GroupMemberEventBuilder } = require('../builders/groupMemberEventBuilder');
const { GroupMemberDiffComputer } = require('../../domain/group/groupMemberDiffComputer');
const { trace } = require('@opentelemetry/api');

// Create OpenTelemetry tracer for Group operations
const tracer = trace.getTracer('clickhouse-group-handler', '1.0.0');

/**
 * Post-save handler for ClickHouse Group member event tracking
 *
 * Architecture: Pure append-only event log with proper write ordering
 * - Member arrays are stripped BEFORE MongoDB save (in databaseBulkInserter)
 * - Original member array is passed via contextData parameter (threaded through BulkInsertUpdateEntry)
 * - ClickHouse writes happen AFTER MongoDB save succeeds (correct ordering)
 * - Writes are INSERTs only, never queries existing state
 * - Reads use argMax aggregation over sorted event log
 * - Event log provides complete audit trail
 *
 * Write Ordering:
 * 1. Strip member[] from resource (databaseBulkInserter)
 * 2. MongoDB.save(strippedResource) → returns doc
 * 3. POST-save handler receives original member[] via contextData parameter
 * 4. Write ClickHouse events
 * Result: If MongoDB fails, no ClickHouse events (correct)
 *
 * Consistency Model:
 * - Groups always use synchronous writes (block API response until ClickHouse write completes)
 * - Read queries use FINAL modifier to force materialized view sync, ensuring read-after-write consistency (FHIR-compliant)
 * - ClickHouse is the source of truth for Group membership - silent data loss is not acceptable
 */
class ClickHouseGroupHandler extends BasePostSaveHandler {
    /**
     * @param {Object} params
     * @param {import('../../utils/clickHouseClientManager').ClickHouseClientManager} params.clickHouseClientManager
     * @param {import('../../utils/configManager').ConfigManager} params.configManager
     * @param {GroupMemberRepository} params.groupMemberRepository
     */
    constructor({ clickHouseClientManager, configManager, groupMemberRepository }) {
        super();
        this.clickHouseClientManager = clickHouseClientManager;
        this.configManager = configManager;
        this.repository = groupMemberRepository;
    }

    /**
     * Declares resource types this handler is designed to process
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
               this.configManager.enableClickHouse &&
               this.configManager.mongoWithClickHouseResources.includes(resourceType);
    }

    /**
     * Determines if this handler requires blocking (synchronous) writes
     * for the given resource type.
     *
     * Groups ALWAYS use sync mode because ClickHouse is the source of truth
     * for membership data. Read-after-write consistency is critical for FHIR compliance.
     *
     * @param {string} resourceType
     * @return {boolean} Always true for Group resources
     */
    shouldBlockForResource(resourceType) {
        // Groups must block to ensure read-after-write consistency
        // ClickHouse is the authoritative source for member data
        return this.canHandle(resourceType);
    }


    /**
     * Processes Group save events, writing member changes to ClickHouse
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

        try {
            // Skip if request is using MongoDB group members
            if (contextData?.useMongoGroupMembers) {
                return;
            }

            // Skip if request is using MongoDB Direct group members (V2)
            if (contextData?.useMongoDirectGroupMembers) {
                return;
            }

            // Check if member events were already written (e.g., by PATCH operations)
            // PATCH writes events directly and sets this flag in contextData
            if (contextData?.groupMemberEventsWritten) {
                logDebug('POST-save: Member events already written, skipping member processing', {
                    groupId: doc.id,
                    eventType
                });
                return;
            }

            // Retrieve original member array from contextData
            // contextData is threaded through BulkInsertUpdateEntry pipeline
            const originalMembers = contextData?.groupMembers || [];

            logDebug('POST-save: Processing Group', {
                groupId: doc.id,
                eventType,
                hasContextData: !!contextData,
                hasOriginalMembers: originalMembers.length > 0,
                originalMemberCount: originalMembers.length
            });

            // Handle Group deletion - MongoDB document deleted, ClickHouse events retained
            //
            // DELETE operations remove the Group document from MongoDB only.
            // ClickHouse event log is preserved as an immutable audit trail.
            //
            // This approach:
            // - Avoids performance/memory issues deleting Groups with millions of members
            // - Maintains complete historical audit trail
            // - Allows queries like "which members were in this Group before deletion?"
            //
            // Future enhancement: The FHIR server publishes change events - a consumer
            // could listen for Group DELETE events and write MEMBER_REMOVED events to
            // ClickHouse asynchronously
            if (eventType === OPERATION_TYPES.DELETE) {
                logDebug('Group deleted - ClickHouse events retained for audit', {
                    groupId: doc.id
                });
                return;
            }

            // CREATE: Write all members as 'added' events
            if (eventType === OPERATION_TYPES.CREATE) {
                if (!originalMembers || originalMembers.length === 0) {
                    logDebug('No members to write for CREATE', {
                        groupId: doc.id
                    });
                    return;
                }
                const docWithMembers = { ...doc, member: originalMembers };

                // Always await - Groups require synchronous writes
                await this._writeMemberEventsIfNeeded(
                    originalMembers,
                    EVENT_TYPES.MEMBER_ADDED,
                    docWithMembers
                );

                logInfo('ClickHouse CREATE events written', {
                    groupId: doc.id,
                    memberCount: originalMembers.length
                });

                return;
            }

            // UPDATE: Compute diff and write events
            if (eventType === OPERATION_TYPES.UPDATE) {
                logDebug('Processing UPDATE', {
                    groupId: doc.id,
                    originalMemberCount: originalMembers.length,
                    eventType
                });

                // Create a doc with original members restored for diff computation
                const docWithMembers = { ...doc, member: originalMembers };

                // Always await - Groups require synchronous writes
                await this._handleUpdateAsync(docWithMembers);

                logInfo('ClickHouse UPDATE events written', {
                    groupId: doc.id
                });
            }

        } catch (error) {
            logError('ClickHouse POST-save handler error', {
                error: error.message,
                groupId: doc.id,
                resourceType,
                eventType
            });

            // IMPORTANT: Propagate error to fail the API request.
            //
            // At this point, MongoDB has already committed the Group resource.
            // If ClickHouse write fails, we have an inconsistent state:
            // - MongoDB: Group exists with member=[] and quantity=0
            // - ClickHouse: No membership events
            //
            // We CANNOT rollback MongoDB (transaction already committed).
            //
            // By throwing the error:
            // - Client receives 500 error (knows operation failed)
            // - Logs capture the failure (detectable via monitoring)
            //
            // When can ClickHouse write fail?
            // - ClickHouse cluster full outage (deployment, config error, infrastructure failure)
            // - Network partition between FHIR server and ClickHouse
            // - ClickHouse under extreme load causing write timeouts
            // - ClickHouse disk full (should be caught by monitoring first)
            //
            // With managed ClickHouse (HA, automatic failover), full outage is unlikely.
            // Most probable scenario: Temporary network partition or extreme load spike.
            // Client gets 500, can retry the operation (idempotent with same correlation_id).
            //
            // For incremental updates (recommended pattern): PATCH operations add members
            // one-at-a-time or in small batches. If one fails, subsequent PATCHes succeed.
            // Impact is limited to that specific batch.
            //
            // To detect orphaned Groups after ClickHouse downtime:
            //
            // MongoDB: const mongoGroupIds = await db.collection('Group_4_0_0').distinct('id');
            // ClickHouse: const chResult = await clickhouse.query('SELECT DISTINCT group_id FROM fhir.fhir_group_member_events');
            // Orphans: mongoGroupIds.filter(id => !chResult.map(r => r.group_id).includes(id))
            //
            // This is better than swallowing the error (200 OK with silent data loss).
            // ClickHouse is the source of truth for Group membership.
            // Silent data loss is not acceptable for clinical cohorts.
            throw new RethrownError({
                message: 'Failed to write Group member events to ClickHouse',
                error,
                args: { groupId: doc.id, resourceType, eventType }
            });
        }
    }


    /**
     * Writes member events if the member array is non-empty
     *
     * @param {Array<Object>} members - Array of FHIR Group.member objects
     * @param {string} eventType - EVENT_TYPES.MEMBER_ADDED or MEMBER_REMOVED
     * @param {Object} groupResource - FHIR Group resource
     * @returns {Promise<void>}
     * @private
     */
    async _writeMemberEventsIfNeeded(members, eventType, groupResource) {
        if (!members || members.length === 0) {
            return;
        }

        return this._appendMemberEventsAsync(groupResource, eventType, members);
    }

    /**
     * Builds and writes combined events for additions and removals in a single INSERT
     *
     * @param {Object} params
     * @param {string} params.groupId - Group resource ID
     * @param {Array<Object>} params.additions - Members to add
     * @param {Array<Object>} params.removals - Members to remove
     * @param {Object} params.groupResource - FHIR Group resource
     * @returns {Promise<void>}
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
     * Appends member events directly (no read, no diff)
     * Pure INSERT operation - O(batch size)
     *
     * @param {Object} groupResource - FHIR Group resource
     * @param {string} eventType - EVENT_TYPES.MEMBER_ADDED or MEMBER_REMOVED
     * @param {Array<Object>} members - Array of FHIR Group.member objects
     * @returns {Promise<void>}
     * @private
     */
    async _appendMemberEventsAsync(groupResource, eventType, members) {
        try {
            // Use GroupMemberEventBuilder to construct events
            const eventBuildStart = Date.now();
            const events = GroupMemberEventBuilder.buildEvents({
                groupId: groupResource.id,
                members,
                eventType,
                groupResource
            });
            const eventBuildTime = Date.now() - eventBuildStart;

            // Pure INSERT - no read operation
            const insertStart = Date.now();
            await this.repository.appendEvents(events);
            const insertTime = Date.now() - insertStart;

            logInfo('Appended member events to ClickHouse', {
                groupId: groupResource.id,
                eventType,
                count: events.length,
                timings: {
                    eventBuildMs: eventBuildTime,
                    clickHouseInsertMs: insertTime,
                    totalMs: eventBuildTime + insertTime
                }
            });
        } catch (error) {
            throw new RethrownError({
                message: 'Error appending Group member events to ClickHouse',
                error,
                args: { groupId: groupResource.id, eventType, memberCount: members.length }
            });
        }
    }

    /**
     * Gets current member references from repository
     *
     * @param {string} groupId - Group resource ID
     * @returns {Promise<Set<string>>} Set of current member references
     * @private
     */
    async _getCurrentMembers(groupId) {
        const references = await this.repository.getActiveMembers(groupId);
        return new Set(references);
    }

    /**
     * Handles Group update by computing diff between current and new members
     * Queries repository for current state, computes diff, writes events
     *
     * @param {Object} groupResource - FHIR Group resource
     * @returns {Promise<{added: number, removed: number, finalCount: number}>} Member change statistics
     * @private
     */
    async _handleUpdateAsync(groupResource) {
        try {
            // Get current members from repository
            const currentReferences = await this._getCurrentMembers(groupResource.id);

            // Compute diff
            const { additions, removals } = GroupMemberDiffComputer.compute(
                currentReferences,
                groupResource.member
            );

            const currentCount = currentReferences.size;
            const finalCount = currentCount + additions.length - removals.length;

            logDebug('Computed member diff', {
                groupId: groupResource.id,
                additions: additions.length,
                removals: removals.length,
                current: currentCount,
                incoming: (groupResource.member || []).length,
                finalCount
            });

            // Write combined events in single INSERT
            await this._writeCombinedEventsAsync({
                groupId: groupResource.id,
                additions,
                removals,
                groupResource
            });

            logInfo('Processed Group update', {
                groupId: groupResource.id,
                added: additions.length,
                removed: removals.length,
                finalCount
            });

            return {
                added: additions.length,
                removed: removals.length,
                finalCount
            };
        } catch (error) {
            throw new RethrownError({
                message: 'Error handling Group update in ClickHouse',
                error,
                args: { groupId: groupResource.id }
            });
        }
    }

    /**
     * Writes Group member events to ClickHouse (for PATCH operations)
     *
     * Called by PATCH operation handler with pre-computed member diffs.
     * Skips the diff computation (which happens in afterSaveAsync for PUT/POST)
     * and writes events directly from provided added/removed arrays.
     *
     * @param {Object} params
     * @param {string} params.groupId - Group resource ID
     * @param {Array<Object>} params.added - Members to add
     * @param {Array<Object>} params.removed - Members to remove
     * @param {Object} params.groupResource - Full Group resource (required for security tags)
     * @returns {Promise<void>}
     * @public
     */
    async writeEventsAsync({ groupId, added = [], removed = [], groupResource }) {
        const startTime = Date.now();
        const totalEvents = added.length + removed.length;

        return tracer.startActiveSpan('group.write_events', {
            attributes: {
                'group.id': groupId,
                'group.events.added': added.length,
                'group.events.removed': removed.length,
                'group.events.total': totalEvents
            }
        }, async (span) => {
            try {
                logDebug('Writing Group member events directly', {
                    groupId,
                    addedCount: added.length,
                    removedCount: removed.length
                });

                if (!groupResource) {
                    throw new Error(`groupResource is required for writeEventsAsync (groupId: ${groupId})`);
                }

                // Write combined events in single INSERT
                await this._writeCombinedEventsAsync({
                    groupId,
                    additions: added,
                    removals: removed,
                    groupResource
                });

                const duration = Date.now() - startTime;

                logInfo('Successfully wrote Group member events', {
                    groupId,
                    addedCount: added.length,
                    removedCount: removed.length,
                    duration_ms: duration
                });

                // Add success metrics to span
                span.setAttributes({
                    'group.write.duration_ms': duration
                });
                span.setStatus({ code: 1 }); // SpanStatusCode.OK
                span.end();
            } catch (error) {
                const duration = Date.now() - startTime;

                // Add error details to span
                span.setAttributes({
                    'group.write.duration_ms': duration,
                    'group.write.error': error.message
                });
                span.setStatus({
                    code: 2, // SpanStatusCode.ERROR
                    message: error.message
                });
                span.recordException(error);
                span.end();

                throw new RethrownError({
                    message: 'Error writing Group member events to ClickHouse',
                    error,
                    args: { groupId, addedCount: added.length, removedCount: removed.length }
                });
            }
        });
    }

}

module.exports = { ClickHouseGroupHandler };
