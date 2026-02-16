const { EVENT_TYPES } = require('../../constants/clickHouseConstants');
const { FhirReferenceParser } = require('../../utils/fhir/referenceParser');
const { SecurityTagExtractor } = require('../../utils/fhir/securityTagExtractor');
const { v4: uuidv4 } = require('uuid');

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
        member,
        groupSourceId,
        groupSourceAuthority,
        accessTags,
        ownerTags
    }) {
        return {
            event_id: uuidv4(),
            group_id: groupId,
            entity_reference: entityReference,
            entity_type: FhirReferenceParser.extractEntityType(entityReference),
            event_type: eventType,
            event_time: eventTime,
            period_start: member?.period?.start || null,
            period_end: member?.period?.end || null,
            inactive: member?.inactive ? 1 : 0,
            group_source_id: groupSourceId,
            group_source_assigning_authority: groupSourceAuthority,
            access_tags: accessTags,
            owner_tags: ownerTags
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
    static buildEvent({ groupId, entityReference, eventType, member, groupResource, eventTime }) {
        const timestamp = eventTime || new Date().toISOString();

        return this._createEventObject({
            groupId,
            entityReference,
            eventType,
            eventTime: timestamp,
            member,
            groupSourceId: groupResource._sourceId || '',
            groupSourceAuthority: groupResource._sourceAssigningAuthority || '',
            accessTags: SecurityTagExtractor.extractAccessTags(groupResource),
            ownerTags: SecurityTagExtractor.extractOwnerTags(groupResource)
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
    static buildEvents({ groupId, members, eventType, groupResource, eventTime }) {
        if (!members || members.length === 0) {
            return [];
        }

        // Optimization: Extract common metadata once for all events
        const timestamp = eventTime || new Date().toISOString();
        const groupSourceId = groupResource._sourceId || '';
        const groupSourceAuthority = groupResource._sourceAssigningAuthority || '';
        const accessTags = SecurityTagExtractor.extractAccessTags(groupResource);
        const ownerTags = SecurityTagExtractor.extractOwnerTags(groupResource);

        return members.map(member => {
            const entityReference = member.entity.reference;

            return this._createEventObject({
                groupId,
                entityReference,
                eventType,
                eventTime: timestamp,
                member,
                groupSourceId,
                groupSourceAuthority,
                accessTags,
                ownerTags
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
    static buildAddedEvents({ groupId, members, groupResource, eventTime }) {
        return this.buildEvents({
            groupId,
            members,
            eventType: EVENT_TYPES.MEMBER_ADDED,
            groupResource,
            eventTime
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
    static buildRemovedEvents({ groupId, members, groupResource, eventTime }) {
        return this.buildEvents({
            groupId,
            members,
            eventType: EVENT_TYPES.MEMBER_REMOVED,
            groupResource,
            eventTime
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
    static buildDiffEvents({ groupId, oldMembers, newMembers, groupResource, eventTime }) {
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

        const addedEvents = this.buildAddedEvents({
            groupId,
            members: addedMembers,
            groupResource,
            eventTime: timestamp
        });

        const removedEvents = this.buildRemovedEvents({
            groupId,
            members: removedMembers,
            groupResource,
            eventTime: timestamp
        });

        return {
            addedEvents,
            removedEvents,
            totalEvents: addedEvents.length + removedEvents.length
        };
    }
}

module.exports = { GroupMemberEventBuilder };
