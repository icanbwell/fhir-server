const { describe, test, expect, beforeEach, jest } = require('@jest/globals');
const { GroupMemberRepository } = require('../../../../dataLayer/repositories/groupMemberRepository');
const { TABLES } = require('../../../../constants/clickHouseConstants');

/**
 * Unit tests for GroupMemberRepository.appendEvents covering:
 *  - B4: ClickHouse insert_deduplicate + deterministic deduplication token
 *  - B5: bounded retry with jittered backoff around the insert
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

    test('B4: enables insert_deduplicate with a deduplication token', async () => {
        await repository.appendEvents([makeEvent({ event_id: 'evt-1' })], { correlationId: 'group-1|3' });

        expect(mockClient.insertAsync).toHaveBeenCalledTimes(1);
        const args = mockClient.insertAsync.mock.calls[0][0];
        expect(args.table).toBe(TABLES.GROUP_MEMBER_EVENTS);
        expect(args.clickhouse_settings.insert_deduplicate).toBe(1);
        expect(args.clickhouse_settings.insert_deduplication_token).toBe('group-1|3|evt-1');
    });

    test('B4: deduplication token is stable across a simulated retry of the same batch', async () => {
        const events = [makeEvent({ event_id: 'evt-1' }), makeEvent({ event_id: 'evt-2', entity_reference: 'Patient/2' })];

        await repository.appendEvents(events, { correlationId: 'group-1|3' });
        await repository.appendEvents(events, { correlationId: 'group-1|3' });

        const token1 = mockClient.insertAsync.mock.calls[0][0].clickhouse_settings.insert_deduplication_token;
        const token2 = mockClient.insertAsync.mock.calls[1][0].clickhouse_settings.insert_deduplication_token;
        expect(token1).toBe(token2);
        expect(token1).toBe('group-1|3|evt-1,evt-2');
    });

    test('B4: retried batch sends identical insert values (idempotent write)', async () => {
        const events = [makeEvent({ event_id: 'evt-1' })];

        await repository.appendEvents(events, { correlationId: 'group-1|3' });
        await repository.appendEvents(events, { correlationId: 'group-1|3' });

        const values1 = mockClient.insertAsync.mock.calls[0][0].values;
        const values2 = mockClient.insertAsync.mock.calls[1][0].values;
        expect(values2).toEqual(values1);
    });

    test('B4: token falls back to event ids when no correlationId supplied', async () => {
        await repository.appendEvents([makeEvent({ event_id: 'evt-1' })]);
        const token = mockClient.insertAsync.mock.calls[0][0].clickhouse_settings.insert_deduplication_token;
        expect(token).toBe('evt-1');
    });

    test('B5: retries a transient insert failure and eventually succeeds', async () => {
        mockClient.insertAsync
            .mockRejectedValueOnce(new Error('transient ClickHouse error'))
            .mockResolvedValueOnce(undefined);

        await repository.appendEvents([makeEvent()], { correlationId: 'group-1|3' });

        expect(mockClient.insertAsync).toHaveBeenCalledTimes(2);
    });

    test('B5: surfaces the error after exhausting retries', async () => {
        mockClient.insertAsync.mockRejectedValue(new Error('ClickHouse down'));

        await expect(
            repository.appendEvents([makeEvent()], { correlationId: 'group-1|3' })
        ).rejects.toThrow(/ClickHouse down|Error appending events/);

        // initial attempt + 3 retries (APPEND_EVENTS_MAX_RETRIES)
        expect(mockClient.insertAsync).toHaveBeenCalledTimes(4);
    }, 20000);
});
