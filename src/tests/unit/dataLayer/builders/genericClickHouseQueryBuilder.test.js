'use strict';

const { describe, test, beforeEach, expect } = require('@jest/globals');
const { GenericClickHouseQueryBuilder } = require('../../../../dataLayer/builders/genericClickHouseQueryBuilder');
const { RESOURCE_COLUMN_TYPES } = require('../../../../constants/clickHouseConstants');

describe('GenericClickHouseQueryBuilder', () => {
    let builder;
    let schema;

    beforeEach(() => {
        builder = new GenericClickHouseQueryBuilder();
        schema = {
            tableName: 'fhir.fhir_test_resource',
            fhirResourceColumn: '_fhir_resource',
            fhirResourceColumnType: RESOURCE_COLUMN_TYPES.STRING,
            seekKey: ['recorded', 'id'],
            fieldMappings: {
                recorded: { column: 'recorded', type: 'datetime' },
                code: { column: 'code_code', type: 'lowcardinality' },
                'subject.reference': { column: 'subject_reference', type: 'reference' },
                status: { column: 'status', type: 'lowcardinality' },
                value: { column: 'value_quantity', type: 'number' }
            },
            securityMappings: {
                accessTags: 'access_tags',
                ownerTags: 'owner_tags',
                sourceAssigningAuthority: 'source_assigning_authority'
            },
            requiredFilters: ['recorded'],
            maxRangeDays: 30
        };
    });

    describe('buildSearchQuery', () => {
        test('equality condition generates correct WHERE', () => {
            const parsed = {
                fieldConditions: [
                    { fieldPath: 'status', column: 'status', type: 'lowcardinality', operator: '$eq', value: 'final' }
                ],
                securityConditions: { accessTags: ['client-a'], ownerTags: [] },
                paginationCursor: null
            };
            const { query, query_params } = builder.buildSearchQuery(parsed, schema);
            expect(query).toContain('status = {_p0:String}');
            expect(query_params._p0).toBe('final');
        });

        test.each([
            ['$gte', '>='],
            ['$gt', '>'],
            ['$lt', '<'],
            ['$lte', '<='],
            ['$ne', '!=']
        ])('operator %s generates %s', (op, sqlOp) => {
            const parsed = {
                fieldConditions: [
                    { fieldPath: 'recorded', column: 'recorded', type: 'datetime', operator: op, value: '2024-01-01' }
                ],
                securityConditions: { accessTags: ['test-access'], ownerTags: [] },
                paginationCursor: null
            };
            const { query } = builder.buildSearchQuery(parsed, schema);
            expect(query).toContain(`recorded ${sqlOp} {_p0:String}`);
        });

        test('$in generates IN clause with Array type', () => {
            const parsed = {
                fieldConditions: [
                    { fieldPath: 'status', column: 'status', type: 'lowcardinality', operator: '$in', value: ['final', 'amended'] }
                ],
                securityConditions: { accessTags: ['test-access'], ownerTags: [] },
                paginationCursor: null
            };
            const { query, query_params } = builder.buildSearchQuery(parsed, schema);
            expect(query).toContain('status IN {_p0:Array(String)}');
            expect(query_params._p0).toEqual(['final', 'amended']);
        });

        test('$in with datetime values coerces array elements', () => {
            const parsed = {
                fieldConditions: [
                    { fieldPath: 'recorded', column: 'recorded', type: 'datetime', operator: '$in', value: ['2024-01-01T00:00:00Z', '2024-02-01T00:00:00Z'] }
                ],
                securityConditions: { accessTags: ['test-access'], ownerTags: [] },
                paginationCursor: null
            };
            const { query_params } = builder.buildSearchQuery(parsed, schema);
            expect(query_params._p0).toEqual(['2024-01-01 00:00:00', '2024-02-01 00:00:00']);
        });

        test('security tags generate hasAny WHERE clauses', () => {
            const parsed = {
                fieldConditions: [],
                securityConditions: { accessTags: ['client-a'], ownerTags: ['org-1'] },
                paginationCursor: null
            };
            const { query, query_params } = builder.buildSearchQuery(parsed, schema);
            expect(query).toContain('hasAny(access_tags, {_accessTags:Array(String)})');
            expect(query).toContain('hasAny(owner_tags, {_ownerTags:Array(String)})');
            expect(query_params._accessTags).toEqual(['client-a']);
            expect(query_params._ownerTags).toEqual(['org-1']);
        });

        test('simple cursor seeks on id column (backward-compatible with _uuid.$gt)', () => {
            const parsed = {
                fieldConditions: [],
                securityConditions: { accessTags: ['test-access'], ownerTags: [] },
                paginationCursor: 'some-uuid-value'
            };
            const { query, query_params } = builder.buildSearchQuery(parsed, schema);
            expect(query).toContain('id > {_sk_id:String}');
            expect(query_params._sk_id).toBe('some-uuid-value');
        });

        test('composite cursor uses full seekKey tuple comparison', () => {
            const cursorObj = { recorded: '2024-06-15 10:30:00.000', id: 'last-id' };
            const parsed = {
                fieldConditions: [],
                securityConditions: { accessTags: ['test-access'], ownerTags: [] },
                paginationCursor: JSON.stringify(cursorObj)
            };
            const { query, query_params } = builder.buildSearchQuery(parsed, schema);
            expect(query).toContain('(recorded, id) > tuple({_sk0:String}, {_sk1:String})');
            expect(query_params._sk0).toBe('2024-06-15 10:30:00.000');
            expect(query_params._sk1).toBe('last-id');
        });

        test('LIMIT and OFFSET are parameterized', () => {
            const parsed = {
                fieldConditions: [],
                securityConditions: { accessTags: ['test-access'], ownerTags: [] },
                paginationCursor: null
            };
            const { query, query_params } = builder.buildSearchQuery(parsed, schema, { limit: 50, skip: 10 });
            expect(query).toContain('LIMIT {_limit:UInt32}');
            expect(query).toContain('OFFSET {_skip:UInt32}');
            expect(query_params._limit).toBe(50);
            expect(query_params._skip).toBe(10);
        });

        test('ORDER BY uses full seekKey tuple', () => {
            const parsed = {
                fieldConditions: [],
                securityConditions: { accessTags: ['test-access'], ownerTags: [] },
                paginationCursor: null
            };
            const { query } = builder.buildSearchQuery(parsed, schema);
            expect(query).toContain('ORDER BY recorded, id');
        });

        test('SELECT uses fhirResourceColumn from schema', () => {
            const parsed = {
                fieldConditions: [],
                securityConditions: { accessTags: ['test-access'], ownerTags: [] },
                paginationCursor: null
            };
            const { query } = builder.buildSearchQuery(parsed, schema);
            expect(query).toContain('SELECT _fhir_resource');
        });

        test('$or conditions grouped with OR', () => {
            const parsed = {
                fieldConditions: [
                    {
                        operator: '$or',
                        conditions: [
                            { fieldPath: 'status', column: 'status', type: 'lowcardinality', operator: '$eq', value: 'final' },
                            { fieldPath: 'status', column: 'status', type: 'lowcardinality', operator: '$eq', value: 'amended' }
                        ]
                    }
                ],
                securityConditions: { accessTags: ['test-access'], ownerTags: [] },
                paginationCursor: null
            };
            const { query } = builder.buildSearchQuery(parsed, schema);
            expect(query).toContain('(status = {_p0:String} OR status = {_p1:String})');
        });

        test('$or with multi-field branches preserves AND grouping', () => {
            const parsed = {
                fieldConditions: [
                    {
                        operator: '$or',
                        conditions: [
                            {
                                operator: '$and',
                                conditions: [
                                    { fieldPath: 'code', column: 'code_code', type: 'lowcardinality', operator: '$eq', value: 'vital-signs' },
                                    { fieldPath: 'status', column: 'status', type: 'lowcardinality', operator: '$eq', value: 'final' }
                                ]
                            },
                            { fieldPath: 'code', column: 'code_code', type: 'lowcardinality', operator: '$eq', value: 'lab' }
                        ]
                    }
                ],
                securityConditions: { accessTags: ['test-access'], ownerTags: [] },
                paginationCursor: null
            };
            const { query } = builder.buildSearchQuery(parsed, schema);
            expect(query).toContain('((code_code = {_p0:String} AND status = {_p1:String}) OR code_code = {_p2:String})');
        });

        test('number type uses Float64 parameter type', () => {
            const parsed = {
                fieldConditions: [
                    { fieldPath: 'value', column: 'value_quantity', type: 'number', operator: '$gt', value: 98.6 }
                ],
                securityConditions: { accessTags: ['test-access'], ownerTags: [] },
                paginationCursor: null
            };
            const { query } = builder.buildSearchQuery(parsed, schema);
            expect(query).toContain('value_quantity > {_p0:Float64}');
        });

        test('no SQL injection via parameterized queries (no raw string interpolation of values)', () => {
            const parsed = {
                fieldConditions: [
                    { fieldPath: 'status', column: 'status', type: 'lowcardinality', operator: '$eq', value: "'; DROP TABLE fhir.test; --" }
                ],
                securityConditions: { accessTags: ['test-access'], ownerTags: [] },
                paginationCursor: null
            };
            const { query, query_params } = builder.buildSearchQuery(parsed, schema);
            // Value goes into params, not into the SQL string
            expect(query).not.toContain('DROP TABLE');
            expect(query).toContain('status = {_p0:String}');
            expect(query_params._p0).toBe("'; DROP TABLE fhir.test; --");
        });
    });

    describe('buildCountQuery', () => {
        test('generates SELECT count()', () => {
            const parsed = {
                fieldConditions: [
                    { fieldPath: 'status', column: 'status', type: 'lowcardinality', operator: '$eq', value: 'final' }
                ],
                securityConditions: { accessTags: ['a'], ownerTags: [] },
                paginationCursor: null
            };
            const { query } = builder.buildCountQuery(parsed, schema);
            expect(query).toContain('SELECT count() AS cnt');
            expect(query).toContain('status = {_p0:String}');
            expect(query).toContain('hasAny(access_tags');
        });
    });

    describe('buildFindByIdQuery', () => {
        test('generates WHERE id = parameterized with security', () => {
            const { query, query_params } = builder.buildFindByIdQuery(
                'resource-123', schema, { accessTags: ['test-access'], ownerTags: [] }
            );
            expect(query).toContain('id = {_id:String}');
            expect(query).toContain('hasAny(access_tags');
            expect(query).toContain('LIMIT 1');
            expect(query_params._id).toBe('resource-123');
        });

        test('findByIdQuery enforces security (throws on empty accessTags)', () => {
            expect(() => builder.buildFindByIdQuery(
                'resource-123', schema, { accessTags: [], ownerTags: [] }
            )).toThrow('Security violation');
        });
    });

    describe('validateRequiredFilters', () => {
        test('passes when required filter is present', () => {
            const parsed = {
                fieldConditions: [
                    { fieldPath: 'recorded', column: 'recorded', type: 'datetime', operator: '$gte', value: '2024-01-01' }
                ],
                securityConditions: { accessTags: ['test-access'], ownerTags: [] },
                paginationCursor: null
            };
            expect(() => builder.validateRequiredFilters(parsed, schema)).not.toThrow();
        });

        test('throws 400 when required filter missing', () => {
            const parsed = {
                fieldConditions: [],
                securityConditions: { accessTags: ['test-access'], ownerTags: [] },
                paginationCursor: null
            };
            expect(() => builder.validateRequiredFilters(parsed, schema)).toThrow("Required filter 'recorded' missing");
            try {
                builder.validateRequiredFilters(parsed, schema);
            } catch (e) {
                expect(e.statusCode).toBe(400);
                expect(e.operationOutcomeCode).toBe('too-costly');
            }
        });

        test('throws when date range exceeds maxRangeDays', () => {
            const parsed = {
                fieldConditions: [
                    { fieldPath: 'recorded', column: 'recorded', type: 'datetime', operator: '$gte', value: '2024-01-01T00:00:00Z' },
                    { fieldPath: 'recorded', column: 'recorded', type: 'datetime', operator: '$lt', value: '2024-03-01T00:00:00Z' }
                ],
                securityConditions: { accessTags: ['test-access'], ownerTags: [] },
                paginationCursor: null
            };
            expect(() => builder.validateRequiredFilters(parsed, schema)).toThrow('exceeds maximum of 30 days');
        });

        test('passes when date range within maxRangeDays', () => {
            const parsed = {
                fieldConditions: [
                    { fieldPath: 'recorded', column: 'recorded', type: 'datetime', operator: '$gte', value: '2024-01-01T00:00:00Z' },
                    { fieldPath: 'recorded', column: 'recorded', type: 'datetime', operator: '$lt', value: '2024-01-15T00:00:00Z' }
                ],
                securityConditions: { accessTags: ['test-access'], ownerTags: [] },
                paginationCursor: null
            };
            expect(() => builder.validateRequiredFilters(parsed, schema)).not.toThrow();
        });

        test('skips validation when no requiredFilters defined', () => {
            const noRequiredSchema = { ...schema, requiredFilters: [] };
            const parsed = {
                fieldConditions: [],
                securityConditions: { accessTags: ['test-access'], ownerTags: [] },
                paginationCursor: null
            };
            expect(() => builder.validateRequiredFilters(parsed, noRequiredSchema)).not.toThrow();
        });
    });

    describe('unsupported operator', () => {
        test('throws on unknown operator', () => {
            const parsed = {
                fieldConditions: [
                    { fieldPath: 'status', column: 'status', type: 'string', operator: '$regex', value: '.*' }
                ],
                securityConditions: { accessTags: ['test-access'], ownerTags: [] },
                paginationCursor: null
            };
            expect(() => builder.buildSearchQuery(parsed, schema)).toThrow('Unsupported operator: $regex');
        });
    });

    describe('security enforcement', () => {
        test('throws on empty accessTags (tenant isolation mandatory)', () => {
            const parsed = {
                fieldConditions: [],
                securityConditions: { accessTags: [], ownerTags: [] },
                paginationCursor: null
            };
            expect(() => builder.buildSearchQuery(parsed, schema)).toThrow('Security violation');
        });

        test('throws when accessTags is undefined', () => {
            const parsed = {
                fieldConditions: [],
                securityConditions: { ownerTags: [] },
                paginationCursor: null
            };
            expect(() => builder.buildSearchQuery(parsed, schema)).toThrow('Security violation');
        });
    });

    describe('type exhaustiveness', () => {
        test('throws on unknown field type', () => {
            const parsed = {
                fieldConditions: [
                    { fieldPath: 'custom', column: 'custom', type: 'unknown_type', operator: '$eq', value: 'x' }
                ],
                securityConditions: { accessTags: ['test-access'], ownerTags: [] },
                paginationCursor: null
            };
            expect(() => builder.buildSearchQuery(parsed, schema)).toThrow("Unknown field type 'unknown_type'");
        });

        test.each([
            ['string', 'String'],
            ['reference', 'String'],
            ['lowcardinality', 'String'],
            ['datetime', 'String'],
            ['number', 'Float64'],
            ['array<string>', 'String']
        ])('field type %s maps to ClickHouse type %s', (fieldType, expectedChType) => {
            const parsed = {
                fieldConditions: [
                    { fieldPath: 'test', column: 'test_col', type: fieldType, operator: '$eq', value: 'x' }
                ],
                securityConditions: { accessTags: ['test-access'], ownerTags: [] },
                paginationCursor: null
            };
            const { query } = builder.buildSearchQuery(parsed, schema);
            expect(query).toContain(`test_col = {_p0:${expectedChType}}`);
        });
    });

    describe('adversarial inputs', () => {
        test('deeply nested $or inside $and inside $or', () => {
            const parsed = {
                fieldConditions: [
                    {
                        operator: '$or',
                        conditions: [
                            {
                                operator: '$and',
                                conditions: [
                                    { fieldPath: 'status', column: 'status', type: 'lowcardinality', operator: '$eq', value: 'final' },
                                    {
                                        operator: '$or',
                                        conditions: [
                                            { fieldPath: 'code', column: 'code_code', type: 'lowcardinality', operator: '$eq', value: 'a' },
                                            { fieldPath: 'code', column: 'code_code', type: 'lowcardinality', operator: '$eq', value: 'b' }
                                        ]
                                    }
                                ]
                            },
                            { fieldPath: 'status', column: 'status', type: 'lowcardinality', operator: '$eq', value: 'amended' }
                        ]
                    }
                ],
                securityConditions: { accessTags: ['a'], ownerTags: [] },
                paginationCursor: null
            };
            const { query } = builder.buildSearchQuery(parsed, schema);
            expect(query).toContain('((status = {_p0:String} AND (code_code = {_p1:String} OR code_code = {_p2:String})) OR status = {_p3:String})');
        });

        test('malformed composite cursor (invalid JSON) falls back to id seek', () => {
            const parsed = {
                fieldConditions: [],
                securityConditions: { accessTags: ['a'], ownerTags: [] },
                paginationCursor: 'not-valid-json{'
            };
            const { query, query_params } = builder.buildSearchQuery(parsed, schema);
            expect(query).toContain('id > {_sk_id:String}');
            expect(query_params._sk_id).toBe('not-valid-json{');
        });

        test('composite cursor with missing seekKey fields falls back to id seek', () => {
            const parsed = {
                fieldConditions: [],
                securityConditions: { accessTags: ['a'], ownerTags: [] },
                paginationCursor: JSON.stringify({ recorded: '2024-01-01 00:00:00' })
            };
            const { query, query_params } = builder.buildSearchQuery(parsed, schema);
            // Missing 'id' in cursor — falls back to simple id seek
            expect(query).toContain('id > {_sk_id:String}');
            expect(query).not.toContain('tuple(');
        });

        test('composite cursor with SQL injection in values uses parameterized query', () => {
            const parsed = {
                fieldConditions: [],
                securityConditions: { accessTags: ['a'], ownerTags: [] },
                paginationCursor: JSON.stringify({ recorded: "'; DROP TABLE fhir.test; --", id: 'ok' })
            };
            const { query, query_params } = builder.buildSearchQuery(parsed, schema);
            expect(query).not.toContain('DROP TABLE');
            expect(query).toContain('tuple({_sk0:String}, {_sk1:String})');
            // Value is parameterized (not in SQL string) — safe regardless of content
            expect(query_params._sk0).toBeDefined();
        });

        test('security: accessTags with empty string still passes (non-empty array)', () => {
            const parsed = {
                fieldConditions: [],
                securityConditions: { accessTags: [''], ownerTags: [] },
                paginationCursor: null
            };
            // Empty string in array is technically a non-empty array — debatable
            // but matching the current behavior. The auth layer should prevent this.
            expect(() => builder.buildSearchQuery(parsed, schema)).not.toThrow();
        });

        test('count query also enforces security', () => {
            const parsed = {
                fieldConditions: [],
                securityConditions: { accessTags: [], ownerTags: [] },
                paginationCursor: null
            };
            expect(() => builder.buildCountQuery(parsed, schema)).toThrow('Security violation');
        });

        test('condition node missing column throws', () => {
            const parsed = {
                fieldConditions: [
                    { fieldPath: 'bad', operator: '$eq', value: 'x', type: 'string' }
                ],
                securityConditions: { accessTags: ['a'], ownerTags: [] },
                paginationCursor: null
            };
            expect(() => builder.buildSearchQuery(parsed, schema)).toThrow('missing column');
        });

        test('maxRangeDays applied to non-required datetime field', () => {
            const schemaWithNonRequired = {
                ...schema,
                requiredFilters: [],
                maxRangeDays: 7
            };
            const parsed = {
                fieldConditions: [
                    { fieldPath: 'recorded', column: 'recorded', type: 'datetime', operator: '$gte', value: '2024-01-01T00:00:00Z' },
                    { fieldPath: 'recorded', column: 'recorded', type: 'datetime', operator: '$lt', value: '2024-02-01T00:00:00Z' }
                ],
                securityConditions: { accessTags: ['a'], ownerTags: [] },
                paginationCursor: null
            };
            expect(() => builder.validateRequiredFilters(parsed, schemaWithNonRequired)).toThrow('exceeds maximum of 7 days');
        });

        test('JSON array cursor falls back to id seek (not a cursor object)', () => {
            const parsed = {
                fieldConditions: [],
                securityConditions: { accessTags: ['a'], ownerTags: [] },
                paginationCursor: JSON.stringify(['not', 'an', 'object'])
            };
            const { query } = builder.buildSearchQuery(parsed, schema);
            expect(query).toContain('id > {_sk_id:String}');
        });
    });
});
