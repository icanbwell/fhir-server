const { describe, test, expect, beforeEach, jest } = require('@jest/globals');
const { GroupMemberRepository } = require('../../../../dataLayer/repositories/groupMemberRepository');
const { TABLES } = require('../../../../constants/clickHouseConstants');

/**
 * Unit tests for GroupMemberRepository.appendEvents covering:
 *  - content-based idempotency. Rows are deterministic (event_id + event_time
 *        baked in by GroupMemberEventBuilder), so a retried block is byte-identical
 *        and argMax collapses duplicates on read. The insert deliberately does NOT
 *        set insert_deduplicate / insert_deduplication_token (inert on this plain
 *        MergeTree engine).
 *  - bounded retry with jittered backoff around the insert
 */
describe('GroupMemberRepository.appendEvents', () => {
    let mockClient;
    let repository;

    const makeEvent = (overrides = {}) => ({
        event_id: 'e1',
        group_id: 'group-1',
        entity_reference: 'Patient/1',
        entity_reference_uuid: 'Patient/uuid-1',
        entity_reference_source_id: 'Patient/1',
        entity_type: 'Patient',
        event_type: 'added',
        event_time: '2024-01-01T00:00:00.000Z',
        period_start: null,
        period_end: null,
        inactive: 0,
        correlation_id: 'group-1|3',
        ...overrides
    });

    beforeEach(() => {
        mockClient = {
            insertAsync: jest.fn().mockResolvedValue(undefined)
        };
        repository = new GroupMemberRepository({ clickHouseClient: mockClient });
    });

    test('does nothing for empty event arrays', async () => {
        await repository.appendEvents([]);
        await repository.appendEvents(null);
        expect(mockClient.insertAsync).not.toHaveBeenCalled();
    });

    test('inserts to the events table and does NOT set the inert dedup settings', async () => {
        await repository.appendEvents([makeEvent({ event_id: 'evt-1' })], { correlationId: 'group-1|3' });

        expect(mockClient.insertAsync).toHaveBeenCalledTimes(1);
        const args = mockClient.insertAsync.mock.calls[0][0];
        expect(args.table).toBe(TABLES.GROUP_MEMBER_EVENTS);
        // The token/insert_deduplicate are no-ops on a plain MergeTree, so they
        // must not be set (relying on them would be a false idempotency guarantee).
        expect(args.clickhouse_settings.insert_deduplicate).toBeUndefined();
        expect(args.clickhouse_settings.insert_deduplication_token).toBeUndefined();
        // Async insert with wait is still configured.
        expect(args.clickhouse_settings.async_insert).toBe(1);
        expect(args.clickhouse_settings.wait_for_async_insert).toBe(1);
    });

    test('a retried block sends byte-identical rows so argMax converges to one state', async () => {
        // The deterministic rows (event_id + event_time) are what make the write
        // idempotent: two physical copies of the same row collapse under argMax.
        const events = [
            makeEvent({ event_id: 'evt-1' }),
            makeEvent({ event_id: 'evt-2', entity_reference: 'Patient/2' })
        ];

        await repository.appendEvents(events, { correlationId: 'group-1|3' });
        await repository.appendEvents(events, { correlationId: 'group-1|3' });

        const values1 = mockClient.insertAsync.mock.calls[0][0].values;
        const values2 = mockClient.insertAsync.mock.calls[1][0].values;
        // Identical event_id + event_time across the retry => argMax dedup on read.
        expect(values2).toEqual(values1);
        expect(values2.map(v => v.event_id)).toEqual(['evt-1', 'evt-2']);
    });

    test('retries a transient insert failure and eventually succeeds', async () => {
        mockClient.insertAsync
            .mockRejectedValueOnce(new Error('transient ClickHouse error'))
            .mockResolvedValueOnce(undefined);

        await repository.appendEvents([makeEvent()], { correlationId: 'group-1|3' });

        expect(mockClient.insertAsync).toHaveBeenCalledTimes(2);
    });

    test('surfaces the error after exhausting retries', async () => {
        mockClient.insertAsync.mockRejectedValue(new Error('ClickHouse down'));

        await expect(
            repository.appendEvents([makeEvent()], { correlationId: 'group-1|3' })
        ).rejects.toThrow(/ClickHouse down|Error appending events/);

        // initial attempt + 3 retries (APPEND_EVENTS_MAX_RETRIES)
        expect(mockClient.insertAsync).toHaveBeenCalledTimes(4);
    }, 20000);
});
