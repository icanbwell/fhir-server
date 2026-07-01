const { TABLES, QUERY_FORMAT } = require('../../constants/clickHouseConstants');
const { QueryFragments } = require('../../utils/clickHouse/queryFragments');
const { RethrownError } = require('../../utils/rethrownError');
const { DateTimeFormatter } = require('../../utils/clickHouse/dateTimeFormatter');
const { retryWithBackoff } = require('../../utils/retryWithBackoff');
const { logWarn } = require('../../operations/common/logging');

// Bounded retry policy for the Group member event insert. This write is on the
// synchronous Group save path (ClickHouse is the source of truth for
// membership) and previously had no retry, so a single transient ClickHouse
// blip surfaced as a 500. Retries are safe because the write is idempotent by
// CONTENT, not by an engine dedup token: each row's event_id is a uuidv5 of
// (group_id | entity_reference | event_type | correlation_id) and event_time is
// deterministic (sourced from meta.lastUpdated), so a re-driven block produces
// byte-identical rows. The Group_4_0_0_MemberEvents table is a plain (non-
// Replicated) MergeTree, and the current-state tables are AggregatingMergeTree
// that resolve state with argMax over (event_time, event_id). Because the retry
// rows are identical, argMax converges to a single logical member state whether
// the block landed once or twice — duplicates are collapsed on read regardless
// of how many physical rows exist. (Note: ClickHouse insert_deduplication_token
// is a no-op here — it is honored only by Replicated*MergeTree for sync inserts,
// or via async_insert_deduplicate on the async path — so we do NOT rely on it.)
const APPEND_EVENTS_MAX_RETRIES = 3;
const APPEND_EVENTS_INITIAL_DELAY_MS = 200;

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
     * Idempotency is by content: the events carry deterministic event_id + event_time
     * (see GroupMemberEventBuilder), so a retried block produces identical rows that
     * argMax collapses to one logical state on read. It does NOT depend on a
     * ClickHouse dedup token (inert on this plain MergeTree engine).
     *
     * @param {Array<Object>} events - Array of event objects with ISO timestamps
     * @param {Object} [options]
     * @param {string} [options.correlationId] - Stable id for the logical operation. Flows into
     *   each event's deterministic event_id (via GroupMemberEventBuilder) so a client retry of the
     *   same logical write yields identical rows. Not used to build any engine-level dedup token.
     * @returns {Promise<void>}
     *
     * @example
     * await repository.appendEvents([
     *   { group_id: 'group-123', entity_reference: 'Patient/1', event_type: 'added',
     *     event_time: '2024-01-01T00:00:00.000Z', ... },
     *   { group_id: 'group-123', entity_reference: 'Patient/2', event_type: 'added',
     *     event_time: '2024-01-01T00:00:00.000Z', ... }
     * ], { correlationId: 'group-123|2' });
     */
    async appendEvents(events, { correlationId } = {}) {
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

            // Bounded retry with jittered backoff. The insert is idempotent by
            // content: the rows are deterministic (deterministic event_id +
            // event_time, see GroupMemberEventBuilder), so a retried block is
            // byte-identical and argMax convergence on the AggregatingMergeTree
            // current-state tables collapses duplicate physical rows to one
            // logical member state on read. We deliberately do NOT set
            // insert_deduplicate / insert_deduplication_token: those are inert on
            // this plain (non-Replicated) MergeTree, so relying on them would be
            // a false guarantee. Correctness rests on the deterministic rows.
            await retryWithBackoff({
                fn: () => this.client.insertAsync({
                    table: TABLES.GROUP_MEMBER_EVENTS,
                    values: formattedEvents,
                    format: QUERY_FORMAT.JSON_EACH_ROW,
                    clickhouse_settings: {
                        async_insert: 1,
                        wait_for_async_insert: 1
                    }
                }),
                maxRetries: APPEND_EVENTS_MAX_RETRIES,
                initialDelayMs: APPEND_EVENTS_INITIAL_DELAY_MS,
                onRetry: ({ attempt, maxRetries, delay, error }) => {
                    logWarn('Retrying Group member event insert to ClickHouse', {
                        attempt,
                        maxRetries,
                        delay,
                        eventCount: formattedEvents.length,
                        error: error?.message
                    });
                }
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
