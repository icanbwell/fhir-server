'use strict';

const { describe, test, beforeEach, expect } = require('@jest/globals');
const { GenericClickHouseQueryParser } = require('./genericClickHouseQueryParser');

describe('GenericClickHouseQueryParser', () => {
    let parser;
    let schema;

    beforeEach(() => {
        parser = new GenericClickHouseQueryParser();
        schema = {
            fieldMappings: {
                recorded: { column: 'recorded', type: 'datetime' },
                'code.coding.code': { column: 'code_code', type: 'lowcardinality' },
                'subject.reference': { column: 'subject_reference', type: 'reference' },
                status: { column: 'status', type: 'lowcardinality' },
                'value.quantity.value': { column: 'value_quantity', type: 'number' }
            }
        };
    });

    describe('field condition extraction', () => {
        test('equality: { field: value } → $eq condition', () => {
            const result = parser.parse({ status: 'final' }, schema);
            expect(result.fieldConditions).toEqual([
                { fieldPath: 'status', column: 'status', type: 'lowcardinality', operator: '$eq', value: 'final' }
            ]);
        });

        test.each([
            ['$gte', { recorded: { $gte: '2024-01-01' } }, '$gte', '2024-01-01'],
            ['$lt', { recorded: { $lt: '2024-02-01' } }, '$lt', '2024-02-01'],
            ['$gt', { recorded: { $gt: '2024-01-01' } }, '$gt', '2024-01-01'],
            ['$lte', { recorded: { $lte: '2024-02-01' } }, '$lte', '2024-02-01'],
            ['$ne', { status: { $ne: 'cancelled' } }, '$ne', 'cancelled']
        ])('range operator %s', (_label, query, expectedOp, expectedValue) => {
            const result = parser.parse(query, schema);
            expect(result.fieldConditions).toHaveLength(1);
            expect(result.fieldConditions[0].operator).toBe(expectedOp);
            expect(result.fieldConditions[0].value).toBe(expectedValue);
        });

        test('$in operator', () => {
            const result = parser.parse({ status: { $in: ['final', 'amended'] } }, schema);
            expect(result.fieldConditions).toEqual([
                { fieldPath: 'status', column: 'status', type: 'lowcardinality', operator: '$in', value: ['final', 'amended'] }
            ]);
        });

        test('date range: $gte + $lt produces two conditions', () => {
            const result = parser.parse({
                recorded: { $gte: '2024-01-01', $lt: '2024-02-01' }
            }, schema);
            expect(result.fieldConditions).toHaveLength(2);
            expect(result.fieldConditions[0].operator).toBe('$gte');
            expect(result.fieldConditions[1].operator).toBe('$lt');
        });

        test('$and: conditions from nested $and are flattened', () => {
            const result = parser.parse({
                $and: [
                    { status: 'final' },
                    { recorded: { $gte: '2024-01-01' } }
                ]
            }, schema);
            expect(result.fieldConditions).toHaveLength(2);
            expect(result.fieldConditions[0].fieldPath).toBe('status');
            expect(result.fieldConditions[1].fieldPath).toBe('recorded');
        });

        test('$or: conditions grouped under $or operator', () => {
            const result = parser.parse({
                $or: [
                    { status: 'final' },
                    { status: 'amended' }
                ]
            }, schema);
            expect(result.fieldConditions).toHaveLength(1);
            expect(result.fieldConditions[0].operator).toBe('$or');
            expect(result.fieldConditions[0].conditions).toHaveLength(2);
        });

        test('unmapped field path is skipped with warning (no error)', () => {
            const result = parser.parse({ 'unknown.field': 'value' }, schema);
            expect(result.fieldConditions).toHaveLength(0);
        });

        test('meta.security fields are skipped (handled by security extraction)', () => {
            const result = parser.parse({
                'meta.security': { $elemMatch: { system: 'https://www.icanbwell.com/access', code: 'test' } },
                status: 'final'
            }, schema);
            expect(result.fieldConditions).toHaveLength(1);
            expect(result.fieldConditions[0].fieldPath).toBe('status');
        });

        test('internal fields starting with _ are skipped', () => {
            const result = parser.parse({ _uuid: { $gt: 'cursor' }, status: 'final' }, schema);
            expect(result.fieldConditions).toHaveLength(1);
            expect(result.fieldConditions[0].fieldPath).toBe('status');
        });
    });

    describe('security tag extraction', () => {
        test('extracts access tags from $elemMatch', () => {
            const result = parser.parse({
                'meta.security': { $elemMatch: { system: 'https://www.icanbwell.com/access', code: 'client-a' } }
            }, schema);
            expect(result.securityConditions.accessTags).toEqual(['client-a']);
        });

        test('extracts owner tags from $elemMatch', () => {
            const result = parser.parse({
                'meta.security': { $elemMatch: { system: 'https://www.icanbwell.com/owner', code: 'org-1' } }
            }, schema);
            expect(result.securityConditions.ownerTags).toEqual(['org-1']);
        });

        test('extracts multiple tags from $in', () => {
            const result = parser.parse({
                'meta.security': { $elemMatch: { system: 'https://www.icanbwell.com/access', code: { $in: ['a', 'b'] } } }
            }, schema);
            expect(result.securityConditions.accessTags).toEqual(['a', 'b']);
        });

        test('extracts tags from nested $and', () => {
            const result = parser.parse({
                $and: [
                    { 'meta.security': { $elemMatch: { system: 'https://www.icanbwell.com/access', code: 'client-a' } } },
                    { 'meta.security': { $elemMatch: { system: 'https://www.icanbwell.com/owner', code: 'org-1' } } }
                ]
            }, schema);
            expect(result.securityConditions.accessTags).toEqual(['client-a']);
            expect(result.securityConditions.ownerTags).toEqual(['org-1']);
        });

        test('extracts _access.* index fields', () => {
            const result = parser.parse({ '_access.client-a': 1 }, schema);
            expect(result.securityConditions.accessTags).toEqual(['client-a']);
        });

        test('deduplicates tags', () => {
            const result = parser.parse({
                $and: [
                    { 'meta.security': { $elemMatch: { system: 'https://www.icanbwell.com/access', code: 'same' } } },
                    { 'meta.security': { $elemMatch: { system: 'https://www.icanbwell.com/access', code: 'same' } } }
                ]
            }, schema);
            expect(result.securityConditions.accessTags).toEqual(['same']);
        });
    });

    describe('pagination cursor', () => {
        test('extracts _uuid.$gt cursor', () => {
            const result = parser.parse({ _uuid: { $gt: 'cursor-123' } }, schema);
            expect(result.paginationCursor).toBe('cursor-123');
        });

        test('extracts cursor from nested $and', () => {
            const result = parser.parse({
                $and: [{ _uuid: { $gt: 'cursor-456' } }, { status: 'final' }]
            }, schema);
            expect(result.paginationCursor).toBe('cursor-456');
        });

        test('returns null when no cursor', () => {
            const result = parser.parse({ status: 'final' }, schema);
            expect(result.paginationCursor).toBeNull();
        });

        test('cursor fields are removed from field conditions', () => {
            const result = parser.parse({
                $and: [{ _uuid: { $gt: 'cursor' } }, { status: 'final' }]
            }, schema);
            expect(result.fieldConditions).toHaveLength(1);
            expect(result.fieldConditions[0].fieldPath).toBe('status');
        });
    });

    describe('empty/null inputs', () => {
        test('empty query returns empty results', () => {
            const result = parser.parse({}, schema);
            expect(result.fieldConditions).toEqual([]);
            expect(result.securityConditions).toEqual({ accessTags: [], ownerTags: [] });
            expect(result.paginationCursor).toBeNull();
        });
    });
});
