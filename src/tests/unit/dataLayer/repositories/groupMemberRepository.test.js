'use strict';

const { describe, test, expect, jest: jestObj, beforeEach } = require('@jest/globals');

// Mock dependencies
jestObj.mock('../../../../constants/clickHouseConstants', () => ({
    TABLES: {
        GROUP_MEMBER_EVENTS: 'fhir.Group_4_0_0_MemberEvents'
    },
    QUERY_FORMAT: {
        JSON_EACH_ROW: 'JSONEachRow'
    },
    EVENT_TYPES: {
        MEMBER_ADDED: 'added',
        MEMBER_REMOVED: 'removed'
    }
}));

jestObj.mock('../../../../utils/clickHouse/queryFragments', () => ({
    QueryFragments: {
        whereGroupId: jestObj.fn().mockReturnValue("WHERE group_id = {groupId:String}"),
        groupByEntityReference: jestObj.fn().mockReturnValue('GROUP BY entity_reference'),
        activeMembers: jestObj.fn().mockReturnValue("argMax(event_type, (event_time, event_id)) = 'added'")
    }
}));

jestObj.mock('../../../../utils/clickHouse/dateTimeFormatter', () => ({
    DateTimeFormatter: {
        toClickHouseDateTime: jestObj.fn((iso) => {
            if (!iso) return null;
            return iso.replace(/T/g, ' ').replace(/Z$/g, '');
        })
    }
}));

jestObj.mock('../../../../utils/rethrownError', () => ({
    RethrownError: class RethrownError extends Error {
        constructor({ message, error, args }) {
            super(message);
            this.name = 'RethrownError';
            this.original_error = error;
            this.args = args;
        }
    }
}));

const { GroupMemberRepository } = require('../../../../dataLayer/repositories/groupMemberRepository');
const { DateTimeFormatter } = require('../../../../utils/clickHouse/dateTimeFormatter');
const { RethrownError } = require('../../../../utils/rethrownError');

describe('GroupMemberRepository', () => {
    let repository;
    let mockClickHouseClient;

    beforeEach(() => {
        jestObj.clearAllMocks();
        mockClickHouseClient = {
            queryAsync: jestObj.fn(),
            insertAsync: jestObj.fn()
        };
        repository = new GroupMemberRepository({ clickHouseClient: mockClickHouseClient });
    });

    describe('getActiveMembers', () => {
        test('calls queryAsync with correct query and params', async () => {
            mockClickHouseClient.queryAsync.mockResolvedValue([
                { entity_reference: 'Patient/1' },
                { entity_reference: 'Patient/2' }
            ]);

            await repository.getActiveMembers('group-123');

            expect(mockClickHouseClient.queryAsync).toHaveBeenCalledTimes(1);
            const callArgs = mockClickHouseClient.queryAsync.mock.calls[0][0];
            expect(callArgs.query_params).toEqual({ groupId: 'group-123' });
            expect(callArgs.query).toContain('SELECT entity_reference');
            expect(callArgs.query).toContain('fhir.Group_4_0_0_MemberEvents');
        });

        test('returns mapped entity_reference values', async () => {
            mockClickHouseClient.queryAsync.mockResolvedValue([
                { entity_reference: 'Patient/1' },
                { entity_reference: 'Patient/2' },
                { entity_reference: 'Patient/3' }
            ]);

            const result = await repository.getActiveMembers('group-456');

            expect(result).toEqual(['Patient/1', 'Patient/2', 'Patient/3']);
        });

        test('returns empty array when queryAsync returns null', async () => {
            mockClickHouseClient.queryAsync.mockResolvedValue(null);

            const result = await repository.getActiveMembers('group-empty');

            expect(result).toEqual([]);
        });

        test('returns empty array when queryAsync returns empty array', async () => {
            mockClickHouseClient.queryAsync.mockResolvedValue([]);

            const result = await repository.getActiveMembers('group-none');

            expect(result).toEqual([]);
        });

        test('throws RethrownError on query failure', async () => {
            const originalError = new Error('Connection timeout');
            mockClickHouseClient.queryAsync.mockRejectedValue(originalError);

            await expect(repository.getActiveMembers('group-fail'))
                .rejects
                .toThrow(RethrownError);

            try {
                await repository.getActiveMembers('group-fail');
            } catch (err) {
                expect(err.message).toBe('Error retrieving active members from repository');
                expect(err.args).toEqual({ groupId: 'group-fail' });
            }
        });
    });

    describe('appendEvents', () => {
        test('does nothing for empty array', async () => {
            await repository.appendEvents([]);

            expect(mockClickHouseClient.insertAsync).not.toHaveBeenCalled();
        });

        test('does nothing for null', async () => {
            await repository.appendEvents(null);

            expect(mockClickHouseClient.insertAsync).not.toHaveBeenCalled();
        });

        test('does nothing for undefined', async () => {
            await repository.appendEvents(undefined);

            expect(mockClickHouseClient.insertAsync).not.toHaveBeenCalled();
        });

        test('converts timestamps via DateTimeFormatter', async () => {
            mockClickHouseClient.insertAsync.mockResolvedValue(undefined);

            const events = [
                {
                    group_id: 'group-1',
                    entity_reference: 'Patient/1',
                    event_type: 'added',
                    event_time: '2024-01-15T10:30:00.000Z',
                    period_start: '2024-01-01T00:00:00.000Z',
                    period_end: '2024-12-31T23:59:59.000Z'
                }
            ];

            await repository.appendEvents(events);

            expect(DateTimeFormatter.toClickHouseDateTime).toHaveBeenCalledWith('2024-01-15T10:30:00.000Z');
            expect(DateTimeFormatter.toClickHouseDateTime).toHaveBeenCalledWith('2024-01-01T00:00:00.000Z');
            expect(DateTimeFormatter.toClickHouseDateTime).toHaveBeenCalledWith('2024-12-31T23:59:59.000Z');
        });

        test('handles null period_start and period_end', async () => {
            mockClickHouseClient.insertAsync.mockResolvedValue(undefined);

            const events = [
                {
                    group_id: 'group-1',
                    entity_reference: 'Patient/1',
                    event_type: 'added',
                    event_time: '2024-01-15T10:30:00.000Z',
                    period_start: null,
                    period_end: null
                }
            ];

            await repository.appendEvents(events);

            const insertCall = mockClickHouseClient.insertAsync.mock.calls[0][0];
            expect(insertCall.values[0].period_start).toBeNull();
            expect(insertCall.values[0].period_end).toBeNull();
        });

        test('calls insertAsync with correct table and settings', async () => {
            mockClickHouseClient.insertAsync.mockResolvedValue(undefined);

            const events = [
                {
                    group_id: 'group-1',
                    entity_reference: 'Patient/1',
                    event_type: 'added',
                    event_time: '2024-01-15T10:30:00.000Z',
                    period_start: null,
                    period_end: null
                }
            ];

            await repository.appendEvents(events);

            const insertCall = mockClickHouseClient.insertAsync.mock.calls[0][0];
            expect(insertCall.table).toBe('fhir.Group_4_0_0_MemberEvents');
            expect(insertCall.format).toBe('JSONEachRow');
            expect(insertCall.clickhouse_settings).toEqual({
                async_insert: 1,
                wait_for_async_insert: 1
            });
        });

        test('throws RethrownError on insert failure', async () => {
            const originalError = new Error('Insert failed');
            mockClickHouseClient.insertAsync.mockRejectedValue(originalError);

            const events = [
                {
                    group_id: 'group-1',
                    entity_reference: 'Patient/1',
                    event_type: 'added',
                    event_time: '2024-01-15T10:30:00.000Z',
                    period_start: null,
                    period_end: null
                }
            ];

            await expect(repository.appendEvents(events))
                .rejects
                .toThrow(RethrownError);

            try {
                await repository.appendEvents(events);
            } catch (err) {
                expect(err.message).toBe('Error appending events to repository');
                expect(err.args).toEqual({ eventCount: 1 });
            }
        });
    });
});
