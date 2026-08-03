'use strict';

const { describe, test, beforeEach, expect } = require('@jest/globals');
const { GenericClickHouseQueryBuilder } = require('../../../../dataLayer/builders/genericClickHouseQueryBuilder');

describe('GenericClickHouseQueryBuilder - Bug-hunting tests', () => {
    let builder;
    let schema;

    beforeEach(() => {
        builder = new GenericClickHouseQueryBuilder();
        schema = {
            tableName: 'fhir.test_table',
            fhirResourceColumn: '_fhir_resource',
            seekKey: ['recorded', 'id'],
            fieldMappings: {
                recorded: { column: 'recorded', type: 'datetime' },
                status: { column: 'status', type: 'lowcardinality' },
                value: { column: 'value_quantity', type: 'number' }
            },
            securityMappings: {
                accessTags: 'access_tags'
            },
            requiredFilters: ['recorded'],
            maxRangeDays: 30
        };
    });

    describe('_orderByClause edge cases', () => {
        test('empty seekKey produces invalid ORDER BY clause', () => {
            const emptySeekSchema = { ...schema, seekKey: [] };
            const parsed = {
                fieldConditions: [],
                securityConditions: { accessTags: [] },
                paginationCursor: null
            };
            // With empty seekKey, ORDER BY produces "ORDER BY " with nothing after it
            // This would be a malformed SQL query sent to ClickHouse
            const { query } = builder.buildSearchQuery(parsed, emptySeekSchema);
            // BUG: ORDER BY with empty join produces "ORDER BY " (trailing space, no columns)
            expect(query).toContain('ORDER BY ');
            // This demonstrates the bug: the ORDER BY clause is just "ORDER BY " with no column names
            const orderByLine = query.split('\n').find(l => l.startsWith('ORDER BY'));
            expect(orderByLine).toBe('ORDER BY ');
        });
    });

    describe('_addSeekClause composite cursor fallback bug', () => {
        test('incomplete composite cursor stores raw JSON string as id fallback', () => {
            // When a composite cursor is missing a seekKey column, it falls back to
            // using the entire JSON string as the _sk_id parameter value.
            // This is a bug: the JSON string is not a valid UUID for seeking.
            const cursorJson = JSON.stringify({ recorded: '2024-01-01 00:00:00' });
            const parsed = {
                fieldConditions: [],
                securityConditions: { accessTags: [] },
                paginationCursor: cursorJson
            };
            const { query_params } = builder.buildSearchQuery(parsed, schema);
            // BUG: _sk_id contains the entire JSON string, not a UUID
            // The fallback sets params[`${RESERVED_PARAMS.SEEK_PREFIX}_id`] = cursor
            // where cursor is the original JSON string: '{"recorded":"2024-01-01 00:00:00"}'
            expect(query_params._sk_id).toBe(cursorJson);
            // This will produce invalid results when used as _uuid > {_sk_id:String}
            // because the value is a JSON object string, not a UUID
        });
    });

    describe('_validateDateRange with invalid dates', () => {
        test('invalid date strings produce NaN range calculation', () => {
            const parsed = {
                fieldConditions: [
                    { fieldPath: 'recorded', column: 'recorded', type: 'datetime', operator: '$gte', value: 'not-a-date' },
                    { fieldPath: 'recorded', column: 'recorded', type: 'datetime', operator: '$lt', value: 'also-not-a-date' }
                ],
                securityConditions: { accessTags: [] },
                paginationCursor: null
            };
            // NaN > schema.maxRangeDays is false, so validation passes with invalid dates
            // This is a potential bug: invalid dates bypass range validation silently
            expect(() => builder.validateRequiredFilters(parsed, schema)).not.toThrow();
        });

        test('one valid and one invalid date produces NaN range - bypasses validation', () => {
            const parsed = {
                fieldConditions: [
                    { fieldPath: 'recorded', column: 'recorded', type: 'datetime', operator: '$gte', value: '2024-01-01T00:00:00Z' },
                    { fieldPath: 'recorded', column: 'recorded', type: 'datetime', operator: '$lt', value: 'invalid' }
                ],
                securityConditions: { accessTags: [] },
                paginationCursor: null
            };
            // (NaN - validTimestamp) / MS_PER_DAY = NaN
            // NaN > 30 is false, so this passes silently
            expect(() => builder.validateRequiredFilters(parsed, schema)).not.toThrow();
        });
    });

    describe('_coerceValue edge cases', () => {
        test('datetime with null value returns null from DateTimeFormatter', () => {
            const parsed = {
                fieldConditions: [
                    { fieldPath: 'recorded', column: 'recorded', type: 'datetime', operator: '$eq', value: null }
                ],
                securityConditions: { accessTags: [] },
                paginationCursor: null
            };
            // null is not a string and not an array, so _coerceValue returns null directly
            // This means the param value will be null, which ClickHouse may reject
            const { query_params } = builder.buildSearchQuery(parsed, schema);
            expect(query_params._p0).toBeNull();
        });

        test('datetime with numeric value passes through without conversion', () => {
            const parsed = {
                fieldConditions: [
                    { fieldPath: 'recorded', column: 'recorded', type: 'datetime', operator: '$gt', value: 1704067200000 }
                ],
                securityConditions: { accessTags: [] },
                paginationCursor: null
            };
            // Numeric value is not string and not array, so it passes through as-is
            // This could cause type mismatch since ClickHouse expects String type for datetime
            const { query_params } = builder.buildSearchQuery(parsed, schema);
            expect(query_params._p0).toBe(1704067200000);
        });
    });

    describe('buildSearchQuery with limit=0', () => {
        test('limit of 0 falls back to DEFAULT_LIMIT due to falsy check', () => {
            const parsed = {
                fieldConditions: [],
                securityConditions: { accessTags: [] },
                paginationCursor: null
            };
            // options.limit || DEFAULT_LIMIT: when limit=0, 0 is falsy so DEFAULT_LIMIT is used
            // This is a bug if a caller intentionally passes limit=0
            const { query_params } = builder.buildSearchQuery(parsed, schema, { limit: 0 });
            expect(query_params._limit).toBe(100); // Gets DEFAULT_LIMIT instead of 0
        });

        test('skip of 0 does not add OFFSET clause', () => {
            const parsed = {
                fieldConditions: [],
                securityConditions: { accessTags: [] },
                paginationCursor: null
            };
            const { query } = builder.buildSearchQuery(parsed, schema, { limit: 10, skip: 0 });
            expect(query).not.toContain('OFFSET');
        });
    });

    describe('buildFindByIdQuery with null securityConditions', () => {
        test('null securityConditions defaults to empty accessTags', () => {
            // The code does: securityConditions || { accessTags: [] }
            // So null is handled, but what about missing accessTags property?
            const { query } = builder.buildFindByIdQuery('id-1', schema, null);
            expect(query).not.toContain('access_tags');
        });

        test('undefined securityConditions defaults to empty accessTags', () => {
            const { query } = builder.buildFindByIdQuery('id-1', schema, undefined);
            expect(query).not.toContain('access_tags');
        });
    });

    describe('array<string> with unsupported operator falls through to scalar path', () => {
        test('array<string> with $gt operator falls through to scalar comparison', () => {
            const parsed = {
                fieldConditions: [
                    { fieldPath: 'tags', column: 'tags', type: 'array<string>', operator: '$gt', value: 'foo' }
                ],
                securityConditions: { accessTags: [] },
                paginationCursor: null
            };
            // BUG: array<string> only handles $in, $eq, $ne.
            // For other operators like $gt, it falls through to the scalar path
            // which generates "tags > {_p0:String}" - invalid for an array column
            const { query } = builder.buildSearchQuery(parsed, schema);
            // This produces a scalar comparison on an array column - will error in ClickHouse
            expect(query).toContain('tags > {_p0:String}');
        });

        test('array<string> with $gte operator falls through to scalar comparison', () => {
            const parsed = {
                fieldConditions: [
                    { fieldPath: 'tags', column: 'tags', type: 'array<string>', operator: '$gte', value: 'bar' }
                ],
                securityConditions: { accessTags: [] },
                paginationCursor: null
            };
            const { query } = builder.buildSearchQuery(parsed, schema);
            expect(query).toContain('tags >= {_p0:String}');
        });
    });

    describe('_conditionTreeToSql with edge cases', () => {
        test('node with conditions but unrecognized operator throws', () => {
            const parsed = {
                fieldConditions: [
                    {
                        operator: '$nor',
                        conditions: [
                            { fieldPath: 'status', column: 'status', type: 'lowcardinality', operator: '$eq', value: 'final' }
                        ]
                    }
                ],
                securityConditions: { accessTags: [] },
                paginationCursor: null
            };
            // A node with conditions but operator '$nor' (not $or/$and):
            // - First if: node.conditions && node.operator === '$or' → false
            // - Second if: node.conditions && node.operator === '$and' → false
            // - Falls through to leaf handler requiring node.column
            // - node.column is undefined → throws "Condition node missing column"
            expect(() => builder.buildSearchQuery(parsed, schema)).toThrow('missing column');
        });

        test('empty $or conditions produces null (filtered out)', () => {
            const parsed = {
                fieldConditions: [
                    {
                        operator: '$or',
                        conditions: []
                    }
                ],
                securityConditions: { accessTags: [] },
                paginationCursor: null
            };
            // parts.length === 0 returns null, which is filtered by .filter(Boolean)
            const { query } = builder.buildSearchQuery(parsed, schema);
            // No WHERE clause generated (null filtered out)
            expect(query).not.toContain('WHERE');
        });
    });
});
