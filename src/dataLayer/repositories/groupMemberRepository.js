const { TABLES, QUERY_FORMAT } = require('../../constants/clickHouseConstants');
const { QueryFragments } = require('../../utils/clickHouse/queryFragments');
const { RethrownError } = require('../../utils/rethrownError');
const { DateTimeFormatter } = require('../../utils/clickHouse/dateTimeFormatter');

/**
 * Repository for Group member data access
 *
 * Encapsulates all query construction and data access logic for Group members,
 * following the Repository pattern to separate business logic from data access.
 *
 * This abstraction allows the handler to work with high-level operations without
 * knowing about table structures, query syntax, or database specifics.
 *
 * The Repository layer is responsible for all database-specific format conversions,
 * including converting ISO timestamps to ClickHouse DateTime64 format.
 */
class GroupMemberRepository {
    /**
     * @param {Object} params
     * @param {import('../../utils/clickHouseClientManager').ClickHouseClientManager} params.clickHouseClient
     */
    constructor({ clickHouseClient }) {
        this.client = clickHouseClient;
    }

    /**
     * Retrieves all currently active member references for a Group
     *
     * Uses event log aggregation to compute current state from history.
     * Returns only the reference strings for efficient set operations.
     *
     * @param {string} groupId - Group resource ID
     * @returns {Promise<string[]>} Array of member reference strings
     *
     * @example
     * const references = await repository.getActiveMembers('group-123');
     * // Returns: ['Patient/1', 'Patient/2', ...]
     */
    async getActiveMembers(groupId) {
        try {
            const query = `
                SELECT entity_reference
                FROM ${TABLES.GROUP_MEMBER_EVENTS}
                ${QueryFragments.whereGroupId('', true)}
                ${QueryFragments.groupByEntityReference()}
                HAVING ${QueryFragments.activeMembers()}
            `;

            const results = await this.client.queryAsync({
                query,
                query_params: { groupId }
            });

            return (results || []).map(row => row.entity_reference);
        } catch (error) {
            throw new RethrownError({
                message: 'Error retrieving active members from repository',
                error,
                args: { groupId }
            });
        }
    }

    /**
     * Appends member events to the event log
     *
     * Pure INSERT operation with no reads or state checks.
     * Events are appended to the immutable log for later aggregation.
     *
     * Converts ISO timestamps to ClickHouse DateTime64 format before insertion.
     * This keeps the EventBuilder domain-focused and centralizes database
     * format concerns in the Repository layer.
     *
     * @param {Array<Object>} events - Array of event objects with ISO timestamps
     * @returns {Promise<void>}
     *
     * @example
     * await repository.appendEvents([
     *   { group_id: 'group-123', entity_reference: 'Patient/1', event_type: 'added',
     *     event_time: '2024-01-01T00:00:00.000Z', ... },
     *   { group_id: 'group-123', entity_reference: 'Patient/2', event_type: 'added',
     *     event_time: '2024-01-01T00:00:00.000Z', ... }
     * ]);
     */
    async appendEvents(events) {
        try {
            if (!events || events.length === 0) {
                return;
            }

            // Convert ISO timestamps to ClickHouse DateTime64 format
            const formattedEvents = events.map(event => ({
                ...event,
                event_time: DateTimeFormatter.toClickHouseDateTime(event.event_time),
                period_start: event.period_start
                    ? DateTimeFormatter.toClickHouseDateTime(event.period_start)
                    : null,
                period_end: event.period_end
                    ? DateTimeFormatter.toClickHouseDateTime(event.period_end)
                    : null
            }));

            await this.client.insertAsync({
                table: TABLES.GROUP_MEMBER_EVENTS,
                values: formattedEvents,
                format: QUERY_FORMAT.JSON_EACH_ROW
            });
        } catch (error) {
            throw new RethrownError({
                message: 'Error appending events to repository',
                error,
                args: { eventCount: events?.length || 0 }
            });
        }
    }
}

module.exports = { GroupMemberRepository };
