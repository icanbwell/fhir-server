'use strict';

const { describe, test, expect } = require('@jest/globals');
const { QueryFragments } = require('../../../../utils/clickHouse/queryFragments');

describe('QueryFragments', () => {
    describe('argMaxWithTieBreaker', () => {
        test('returns argMax with default tie-breaker', () => {
            const result = QueryFragments.argMaxWithTieBreaker('event_type');
            expect(result).toBe('argMax(event_type, (event_time, event_id))');
        });

        test('returns argMax with custom orderBy', () => {
            const result = QueryFragments.argMaxWithTieBreaker('status', '(created_at, id)');
            expect(result).toBe('argMax(status, (created_at, id))');
        });
    });

    describe('activeMembers', () => {
        test('returns HAVING clause filtering for added members', () => {
            const result = QueryFragments.activeMembers();
            expect(result).toContain("argMax(event_type, (event_time, event_id)) = 'added'");
        });
    });

    describe('seekAfter', () => {
        test('returns empty string when afterValue is null', () => {
            expect(QueryFragments.seekAfter(null)).toBe('');
        });

        test('returns empty string when afterValue is undefined', () => {
            expect(QueryFragments.seekAfter(undefined)).toBe('');
        });

        test('returns empty string when afterValue is empty string', () => {
            expect(QueryFragments.seekAfter('')).toBe('');
        });

        test('returns AND clause with default column', () => {
            const result = QueryFragments.seekAfter('Patient/100');
            expect(result).toBe("AND entity_reference > 'Patient/100'");
        });

        test('returns AND clause with custom column', () => {
            const result = QueryFragments.seekAfter('some-value', 'group_id');
            expect(result).toBe("AND group_id > 'some-value'");
        });

        test('escapes single quotes in value using double single quotes', () => {
            const result = QueryFragments.seekAfter("Patient/O'Brien");
            expect(result).toBe("AND entity_reference > 'Patient/O''Brien'");
        });

        test('throws on invalid column name to prevent SQL injection', () => {
            expect(() => QueryFragments.seekAfter('value', 'invalid_column'))
                .toThrow('Invalid column name: invalid_column');
        });

        test('throws on column name with SQL injection attempt', () => {
            expect(() => QueryFragments.seekAfter('value', "entity_reference; DROP TABLE--"))
                .toThrow('Invalid column name');
        });

        test('allows all valid column names', () => {
            const validColumns = ['entity_reference', 'group_id', 'event_time', 'event_id', 'access_tags', 'owner_tags'];
            for (const col of validColumns) {
                expect(() => QueryFragments.seekAfter('value', col)).not.toThrow();
            }
        });
    });

    describe('seekAfterParameterized', () => {
        test('returns empty clause when afterValue is null', () => {
            const result = QueryFragments.seekAfterParameterized(null);
            expect(result).toEqual({ clause: '', hasCondition: false });
        });

        test('returns empty clause when afterValue is empty', () => {
            const result = QueryFragments.seekAfterParameterized('');
            expect(result).toEqual({ clause: '', hasCondition: false });
        });

        test('returns parameterized clause with default column', () => {
            const result = QueryFragments.seekAfterParameterized('Patient/100');
            expect(result).toEqual({
                clause: 'AND entity_reference > {afterReference:String}',
                hasCondition: true
            });
        });

        test('returns parameterized clause with custom column', () => {
            const result = QueryFragments.seekAfterParameterized('value', 'group_id');
            expect(result).toEqual({
                clause: 'AND group_id > {afterReference:String}',
                hasCondition: true
            });
        });
    });

    describe('whereGroupId', () => {
        test('returns parameterized WHERE clause when parameterized is true', () => {
            const result = QueryFragments.whereGroupId('550e8400-e29b-41d4-a716-446655440000', true);
            expect(result).toBe('WHERE group_id = {groupId:String}');
        });

        test('returns literal WHERE clause with valid UUID', () => {
            const result = QueryFragments.whereGroupId('550e8400-e29b-41d4-a716-446655440000');
            expect(result).toBe("WHERE group_id = '550e8400-e29b-41d4-a716-446655440000'");
        });

        test('throws on invalid UUID format', () => {
            expect(() => QueryFragments.whereGroupId('not-a-uuid'))
                .toThrow('Invalid group ID format. Must be a UUID.');
        });

        test('throws on UUID with SQL injection', () => {
            expect(() => QueryFragments.whereGroupId("'; DROP TABLE--"))
                .toThrow('Invalid group ID format. Must be a UUID.');
        });

        test('accepts uppercase UUID', () => {
            const result = QueryFragments.whereGroupId('550E8400-E29B-41D4-A716-446655440000');
            expect(result).toBe("WHERE group_id = '550E8400-E29B-41D4-A716-446655440000'");
        });
    });

    describe('whereEntityReference', () => {
        test('returns parameterized WHERE clause when parameterized is true', () => {
            const result = QueryFragments.whereEntityReference('Patient/123', true);
            expect(result).toBe('WHERE entity_reference = {entityReference:String}');
        });

        test('returns literal WHERE clause for FHIR reference', () => {
            const result = QueryFragments.whereEntityReference('Patient/123');
            expect(result).toBe("WHERE entity_reference = 'Patient/123'");
        });

        test('escapes single quotes in entity reference', () => {
            const result = QueryFragments.whereEntityReference("Patient/O'Brien");
            expect(result).toBe("WHERE entity_reference = 'Patient/O''Brien'");
        });
    });

    describe('groupByEntityReference', () => {
        test('returns GROUP BY clause', () => {
            expect(QueryFragments.groupByEntityReference()).toBe('GROUP BY entity_reference');
        });
    });

    describe('orderByEntityReference', () => {
        test('returns ORDER BY ASC by default', () => {
            expect(QueryFragments.orderByEntityReference()).toBe('ORDER BY entity_reference ASC');
        });

        test('returns ORDER BY ASC when specified', () => {
            expect(QueryFragments.orderByEntityReference('ASC')).toBe('ORDER BY entity_reference ASC');
        });

        test('returns ORDER BY DESC when specified', () => {
            expect(QueryFragments.orderByEntityReference('DESC')).toBe('ORDER BY entity_reference DESC');
        });

        test('normalizes lowercase direction to uppercase', () => {
            expect(QueryFragments.orderByEntityReference('asc')).toBe('ORDER BY entity_reference ASC');
            expect(QueryFragments.orderByEntityReference('desc')).toBe('ORDER BY entity_reference DESC');
        });

        test('throws on invalid direction', () => {
            expect(() => QueryFragments.orderByEntityReference('INVALID'))
                .toThrow('Invalid direction. Must be one of: ASC, DESC');
        });

        test('throws on SQL injection attempt in direction', () => {
            expect(() => QueryFragments.orderByEntityReference("ASC; DROP TABLE--"))
                .toThrow('Invalid direction');
        });
    });

    describe('limit', () => {
        test('returns LIMIT clause with integer', () => {
            expect(QueryFragments.limit(100)).toBe('LIMIT 100');
        });

        test('parses string to integer', () => {
            expect(QueryFragments.limit('50')).toBe('LIMIT 50');
        });

        test('truncates float to integer', () => {
            expect(QueryFragments.limit(10.7)).toBe('LIMIT 10');
        });

        test('returns NaN for non-numeric input (defensive check)', () => {
            // parseInt of a non-numeric string returns NaN
            expect(QueryFragments.limit('abc')).toBe('LIMIT NaN');
        });
    });

    describe('whereAccessTags', () => {
        test('returns hasAny clause for access tags', () => {
            const result = QueryFragments.whereAccessTags(['client1', 'client2']);
            expect(result).toBe("AND hasAny(access_tags, ['client1', 'client2'])");
        });

        test('returns parameterized clause when parameterized is true', () => {
            const result = QueryFragments.whereAccessTags(['client1'], true);
            expect(result).toBe('AND hasAny(access_tags, {accessTags:Array(String)})');
        });

        test('escapes single quotes in tags', () => {
            const result = QueryFragments.whereAccessTags(["client'1"]);
            expect(result).toBe("AND hasAny(access_tags, ['client''1'])");
        });

        test('throws on empty array (security check)', () => {
            expect(() => QueryFragments.whereAccessTags([]))
                .toThrow('Security violation: accessTags cannot be empty');
        });

        test('throws on null (security check)', () => {
            expect(() => QueryFragments.whereAccessTags(null))
                .toThrow('Security violation: accessTags cannot be empty');
        });

        test('throws on undefined (security check)', () => {
            expect(() => QueryFragments.whereAccessTags(undefined))
                .toThrow('Security violation: accessTags cannot be empty');
        });

        test('throws on non-array (security check)', () => {
            expect(() => QueryFragments.whereAccessTags('client1'))
                .toThrow('Security violation: accessTags cannot be empty');
        });

        test('handles multiple tags correctly', () => {
            const result = QueryFragments.whereAccessTags(['a', 'b', 'c']);
            expect(result).toBe("AND hasAny(access_tags, ['a', 'b', 'c'])");
        });
    });

    describe('whereOwnerTags', () => {
        test('returns hasAny clause for owner tags', () => {
            const result = QueryFragments.whereOwnerTags(['org1']);
            expect(result).toBe("AND hasAny(owner_tags, ['org1'])");
        });

        test('returns parameterized clause when parameterized is true', () => {
            const result = QueryFragments.whereOwnerTags(['org1'], true);
            expect(result).toBe('AND hasAny(owner_tags, {ownerTags:Array(String)})');
        });

        test('escapes single quotes in owner tags', () => {
            const result = QueryFragments.whereOwnerTags(["org'1"]);
            expect(result).toBe("AND hasAny(owner_tags, ['org''1'])");
        });

        test('throws on empty array (security check)', () => {
            expect(() => QueryFragments.whereOwnerTags([]))
                .toThrow('Security violation: ownerTags cannot be empty');
        });

        test('throws on null (security check)', () => {
            expect(() => QueryFragments.whereOwnerTags(null))
                .toThrow('Security violation: ownerTags cannot be empty');
        });

        test('throws on undefined (security check)', () => {
            expect(() => QueryFragments.whereOwnerTags(undefined))
                .toThrow('Security violation: ownerTags cannot be empty');
        });

        test('throws on non-array (security check)', () => {
            expect(() => QueryFragments.whereOwnerTags('org1'))
                .toThrow('Security violation: ownerTags cannot be empty');
        });

        test('handles multiple owner tags', () => {
            const result = QueryFragments.whereOwnerTags(['org1', 'org2']);
            expect(result).toBe("AND hasAny(owner_tags, ['org1', 'org2'])");
        });
    });
});
