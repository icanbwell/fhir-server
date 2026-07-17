const { EVENT_TYPES } = require('../../constants/clickHouseConstants');
const { FhirReferenceParser } = require('../../utils/fhir/referenceParser');
const { SecurityTagExtractor } = require('../../utils/fhir/securityTagExtractor');
const { logWarn, logError } = require('../../operations/common/logging');
const { generateUUIDv5 } = require('../../utils/uid.util');

/**
 * Builder class for constructing Group member event objects
 *
 * This centralizes the logic for creating event records that track Group member
 * additions, removals, and lifecycle changes.
 *
 * Events are returned with ISO timestamps (FHIR standard format).
 * The Repository layer is responsible for converting to database-specific formats.
 */
class GroupMemberEventBuilder {
    /**
     * Extracts and validates source_assigning_authority from owner_tags
     * Matches MongoDB's sourceAssigningAuthorityColumnHandler behavior
     *
     * @param {Array<string>} ownerTags - Owner tag codes
     * @param {string} groupId - Group ID for error logging
     * @param {string} entityReference - Entity reference for error logging
     * @returns {string} First owner tag (managing organization)
     * @throws {Error} If ownerTags is empty
     * @private
     */
    static _extractSourceAssigningAuthority(ownerTags, groupId, entityReference) {
        if (!ownerTags || ownerTags.length === 0) {
            const error = new Error(
                `Invalid owner_tags for Group ${groupId}: Must have at least one owner tag. ` +
                `source_assigning_authority cannot be derived without an owner.`
            );

            logError('Group event rejected: No owner_tags', {
                groupId,
                entityReference,
                ownerTagsCount: 0,
                ownerTags,
                error: error.message
            });

            throw error;
        }

        if (ownerTags.length > 1) {
            logWarn('Group has multiple owner tags, using first', {
                groupId,
                entityReference,
                ownerTagsCount: ownerTags.length,
                ownerTags,
                selectedOwner: ownerTags[0]
            });
        }

        return ownerTags[0];
    }

    /**
     * Derives a stable, deterministic event_id for idempotent retries.
     *
     * The Group member events table is an append-only MergeTree. A client that
     * retries a failed write (e.g. after a 500 from a transient ClickHouse
     * outage) must not create duplicate rows. By deriving event_id as a uuidv5
     * of (group_id | entity_reference | event_type | correlation_id), a retry
     * of the SAME logical operation produces the SAME event_id. Combined with a
     * deterministic event_time (see the handler, which sources it from
     * meta.lastUpdated) the full row — and thus the MergeTree ORDER BY key —
     * is identical on retry, so argMax aggregation converges to one logical
     * member state instead of diverging across duplicate rows.
     *
     * @param {string} groupId
     * @param {string} entityReference
     * @param {string} eventType
     * @param {string} correlationId - Stable identifier for the logical operation
     * @returns {string} Deterministic UUID
     * @private
     */
    static _deriveEventId(groupId, entityReference, eventType, correlationId) {
        return generateUUIDv5(`${groupId}|${entityReference}|${eventType}|${correlationId}`);
    }

    /**
     * Extracts the FHIR meta.versionId as a non-negative integer for causal ordering.
     *
     * meta.versionId is server-assigned and increments on every write to the resource, so a
     * causally-later operation carries a higher version_id. It is the leading term of the
     * current-state argMax tie-break tuple (version_id, batch_seq, event_time, event_id), so a
     * later add/remove deterministically wins over an earlier one instead of the tie being decided
     * by event_id — a content hash, not causal order. A retry of the same committed version reuses
     * the same version_id, so idempotency is preserved.
     *
     * @param {Object} groupResource
     * @returns {number} versionId as a positive integer, or 0 when missing/unparseable
     * @private
     */
    static _extractVersionId(groupResource) {
        const parsed = parseInt(groupResource?.meta?.versionId, 10);
        if (Number.isFinite(parsed) && parsed > 0) {
            return parsed;
        }
        // A committed resource always has meta.versionId >= 1. A 0 here means it was missing or
        // unparseable — unexpected on the live path. Warn but do not throw: 0 still sorts beneath
        // any real version, and pre-migration rows legitimately default to 0.
        logWarn('Group member event has no usable meta.versionId; defaulting version_id to 0', {
            groupId: groupResource?.id,
            versionId: groupResource?.meta?.versionId
        });
        return 0;
    }

    /**
     * Creates an event object with all required fields
     * Returns events with ISO timestamps (domain format).
     * Repository layer handles database-specific format conversions.
     * @private
     */
    static _createEventObject({
        groupId,
        entityReference,
        eventType,
        eventTime,
        versionId = 0,
        batchSeq = 0,
        member,
        groupSourceId,
        groupSourceAuthority,
        accessTags,
        ownerTags,
        correlationId
    }) {
        const sourceAssigningAuthority = this._extractSourceAssigningAuthority(
            ownerTags,
            groupId,
            entityReference
        );

        // Read enriched reference fields set by referenceGlobalIdHandler pre-save.
        // _uuid and _sourceId already include the resource type prefix (e.g., "Patient/<uuid>")
        const entityReferenceUuid = member?.entity?._uuid || '';
        const entityReferenceSourceId = member?.entity?._sourceId || '';

        if (!entityReferenceUuid) {
            throw new Error(
                `Member reference missing _uuid for Group ${groupId}: ${entityReference}. ` +
                    'Pre-save handler (referenceGlobalIdHandler) must run before event building.'
            );
        }
        if (!entityReferenceSourceId) {
            throw new Error(
                `Member reference missing _sourceId for Group ${groupId}: ${entityReference}. ` +
                    'Pre-save handler (referenceGlobalIdHandler) must run before event building.'
            );
        }

        // Stable correlation id for the logical operation. Falls back to the
        // entity reference so a missing correlation still yields a deterministic
        // (though per-reference-only) id rather than a random one.
        const effectiveCorrelationId = correlationId || `${groupId}|${entityReference}`;

        return {
            event_id: this._deriveEventId(groupId, entityReference, eventType, effectiveCorrelationId),
            group_id: groupId,
            entity_reference: entityReference,
            entity_reference_uuid: entityReferenceUuid,
            entity_reference_source_id: entityReferenceSourceId,
            entity_type: FhirReferenceParser.extractEntityType(entityReference),
            event_type: eventType,
            event_time: eventTime,
            // Causal-ordering tie-break terms: version_id leads, batch_seq disambiguates events
            // within a single write, both sitting above event_time/event_id in the argMax tuple.
            version_id: versionId,
            batch_seq: batchSeq,
            period_start: member?.period?.start || null,
            period_end: member?.period?.end || null,
            inactive: member?.inactive ? 1 : 0,
            correlation_id: effectiveCorrelationId,
            group_source_id: groupSourceId,
            group_source_assigning_authority: groupSourceAuthority,
            access_tags: accessTags,
            owner_tags: ownerTags,
            source_assigning_authority: sourceAssigningAuthority
        };
    }

    /**
     * Builds an event object for a Group member change
     *
     * @param {Object} params
     * @param {string} params.groupId - Group UUID (unique identifier)
     * @param {string} params.entityReference - FHIR reference (e.g., "Patient/123")
     * @param {string} params.eventType - EVENT_TYPES.MEMBER_ADDED or MEMBER_REMOVED
     * @param {Object} [params.member] - FHIR Group.member object (optional, for period/inactive)
     * @param {Object} params.groupResource - Full Group resource for metadata extraction
     * @param {string} [params.eventTime] - ISO timestamp (defaults to now)
     * @param {string} [params.correlationId] - Stable id for the logical operation (enables idempotent retries)
     *
     * @returns {Object} Event object ready for insertion
     *
     * @example
     * const event = GroupMemberEventBuilder.buildEvent({
     *   groupId: '550e8400-e29b-41d4-a716-446655440000',
     *   entityReference: 'Patient/123',
     *   eventType: EVENT_TYPES.MEMBER_ADDED,
     *   member: {
     *     entity: { reference: 'Patient/123' },
     *     period: { start: '2024-01-01T00:00:00Z' },
     *     inactive: false
     *   },
     *   groupResource: { id: '...', meta: { security: [...] }, ... }
     * });
     */
    static buildEvent({ groupId, entityReference, eventType, member, groupResource, eventTime, correlationId }) {
        const timestamp = eventTime || new Date().toISOString();

        return this._createEventObject({
            groupId,
            entityReference,
            eventType,
            eventTime: timestamp,
            versionId: this._extractVersionId(groupResource),
            batchSeq: 0,
            member,
            groupSourceId: groupResource._sourceId || '',
            groupSourceAuthority: groupResource._sourceAssigningAuthority || '',
            accessTags: SecurityTagExtractor.extractAccessTags(groupResource),
            ownerTags: SecurityTagExtractor.extractOwnerTags(groupResource),
            correlationId
        });
    }

    /**
     * Builds multiple events from a member array
     *
     * Convenient for bulk operations when adding/removing many members at once.
     * Optimized: Extracts common metadata once and reuses for all events.
     *
     * @param {Object} params
     * @param {string} params.groupId - Group UUID
     * @param {Array} params.members - Array of Group.member objects
     * @param {string} params.eventType - EVENT_TYPES.MEMBER_ADDED or MEMBER_REMOVED
     * @param {Object} params.groupResource - Full Group resource
     * @param {string} [params.eventTime] - ISO timestamp (defaults to now, same for all events)
     *
     * @returns {Array<Object>} Array of event objects
     *
     * @example
     * const events = GroupMemberEventBuilder.buildEvents({
     *   groupId: '550e8400-e29b-41d4-a716-446655440000',
     *   members: [
     *     { entity: { reference: 'Patient/1' } },
     *     { entity: { reference: 'Patient/2' } }
     *   ],
     *   eventType: EVENT_TYPES.MEMBER_ADDED,
     *   groupResource: groupDoc
     * });
     */
    static buildEvents({ groupId, members, eventType, groupResource, eventTime, correlationId, batchSeqOffset = 0 }) {
        if (!members || members.length === 0) {
            return [];
        }

        // Optimization: Extract common metadata once for all events
        const timestamp = eventTime || new Date().toISOString();
        const groupSourceId = groupResource._sourceId || '';
        const groupSourceAuthority = groupResource._sourceAssigningAuthority || '';
        const accessTags = SecurityTagExtractor.extractAccessTags(groupResource);
        const ownerTags = SecurityTagExtractor.extractOwnerTags(groupResource);
        // version_id is per-resource-version (same for every event in this write); batch_seq is the
        // per-event index within the write. batchSeqOffset lets a caller assembling a combined
        // add+remove batch keep batch_seq globally monotonic across both sub-batches.
        const versionId = this._extractVersionId(groupResource);

        return members.map((member, index) => {
            const entityReference = member.entity.reference;

            return this._createEventObject({
                groupId,
                entityReference,
                eventType,
                eventTime: timestamp,
                versionId,
                batchSeq: batchSeqOffset + index,
                member,
                groupSourceId,
                groupSourceAuthority,
                accessTags,
                ownerTags,
                correlationId
            });
        });
    }

    /**
     * Builds events for member additions (syntactic sugar)
     *
     * @param {Object} params
     * @param {string} params.groupId
     * @param {Array} params.members
     * @param {Object} params.groupResource
     * @param {string} [params.eventTime]
     *
     * @returns {Array<Object>} Array of "added" events
     */
    static buildAddedEvents({ groupId, members, groupResource, eventTime, correlationId, batchSeqOffset = 0 }) {
        return this.buildEvents({
            groupId,
            members,
            eventType: EVENT_TYPES.MEMBER_ADDED,
            groupResource,
            eventTime,
            correlationId,
            batchSeqOffset
        });
    }

    /**
     * Builds events for member removals (syntactic sugar)
     *
     * @param {Object} params
     * @param {string} params.groupId
     * @param {Array} params.members
     * @param {Object} params.groupResource
     * @param {string} [params.eventTime]
     *
     * @returns {Array<Object>} Array of "removed" events
     */
    static buildRemovedEvents({ groupId, members, groupResource, eventTime, correlationId, batchSeqOffset = 0 }) {
        return this.buildEvents({
            groupId,
            members,
            eventType: EVENT_TYPES.MEMBER_REMOVED,
            groupResource,
            eventTime,
            correlationId,
            batchSeqOffset
        });
    }

    /**
     * Computes diff between old and new member arrays and builds corresponding events
     *
     * Used during UPDATE operations to determine which members were added/removed.
     *
     * @param {Object} params
     * @param {string} params.groupId
     * @param {Array} params.oldMembers - Previous Group.member array (may be empty)
     * @param {Array} params.newMembers - New Group.member array
     * @param {Object} params.groupResource
     * @param {string} [params.eventTime]
     *
     * @returns {Object} { addedEvents: Array, removedEvents: Array, totalEvents: number }
     *
     * @example
     * const diff = GroupMemberEventBuilder.buildDiffEvents({
     *   groupId: '...',
     *   oldMembers: [{ entity: { reference: 'Patient/1' } }],
     *   newMembers: [{ entity: { reference: 'Patient/2' } }],
     *   groupResource: groupDoc
     * });
     * // Returns: { addedEvents: [Patient/2], removedEvents: [Patient/1], totalEvents: 2 }
     */
    static buildDiffEvents({ groupId, oldMembers, newMembers, groupResource, eventTime, correlationId }) {
        const timestamp = eventTime || new Date().toISOString();

        // Create sets of references for efficient lookup
        const oldRefs = new Set(
            (oldMembers || []).map(m => m.entity?.reference).filter(Boolean)
        );
        const newRefs = new Set(
            (newMembers || []).map(m => m.entity?.reference).filter(Boolean)
        );

        // Find added members (in new but not in old)
        const addedMembers = (newMembers || []).filter(
            m => m.entity?.reference && !oldRefs.has(m.entity.reference)
        );

        // Find removed members (in old but not in new)
        const removedMembers = (oldMembers || []).filter(
            m => m.entity?.reference && !newRefs.has(m.entity.reference)
        );

        // Keep batch_seq monotonic across the combined batch: additions occupy [0, added), removals
        // continue at [added, added + removed) so the two sub-batches never collide.
        const addedEvents = this.buildAddedEvents({
            groupId,
            members: addedMembers,
            groupResource,
            eventTime: timestamp,
            correlationId,
            batchSeqOffset: 0
        });

        const removedEvents = this.buildRemovedEvents({
            groupId,
            members: removedMembers,
            groupResource,
            eventTime: timestamp,
            correlationId,
            batchSeqOffset: addedMembers.length
        });

        return {
            addedEvents,
            removedEvents,
            totalEvents: addedEvents.length + removedEvents.length
        };
    }
}

module.exports = { GroupMemberEventBuilder };
