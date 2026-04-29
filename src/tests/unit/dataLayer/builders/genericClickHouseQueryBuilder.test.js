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
                securityConditions: { accessTags: ['client-a'] },
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
                securityConditions: { accessTags: ['test-access'] },
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
                securityConditions: { accessTags: ['test-access'] },
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
                securityConditions: { accessTags: ['test-access'] },
                paginationCursor: null
            };
            const { query_params } = builder.buildSearchQuery(parsed, schema);
            expect(query_params._p0).toEqual(['2024-01-01 00:00:00', '2024-02-01 00:00:00']);
        });

        test('security tags generate hasAny WHERE clauses', () => {
            const parsed = {
                fieldConditions: [],
                securityConditions: { accessTags: ['client-a'] },
                paginationCursor: null
            };
            const { query, query_params } = builder.buildSearchQuery(parsed, schema);
            expect(query).toContain('hasAny(access_tags, {_accessTags:Array(String)})');
            expect(query_params._accessTags).toEqual(['client-a']);
        });

        test('simple cursor seeks on id column (backward-compatible with _uuid.$gt)', () => {
            const parsed = {
                fieldConditions: [],
                securityConditions: { accessTags: ['test-access'] },
                paginationCursor: 'some-uuid-value'
            };
            const { query, query_params } = builder.buildSearchQuery(parsed, schema);
            expect(query).toContain('_uuid > {_sk_id:String}');
            expect(query_params._sk_id).toBe('some-uuid-value');
        });

        test('composite cursor uses full seekKey tuple comparison', () => {
            const cursorObj = { recorded: '2024-06-15 10:30:00.000', id: 'last-id' };
            const parsed = {
                fieldConditions: [],
                securityConditions: { accessTags: ['test-access'] },
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
                securityConditions: { accessTags: ['test-access'] },
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
                securityConditions: { accessTags: ['test-access'] },
                paginationCursor: null
            };
            const { query } = builder.buildSearchQuery(parsed, schema);
            expect(query).toContain('ORDER BY recorded, id');
        });

        test('SELECT uses fhirResourceColumn from schema', () => {
            const parsed = {
                fieldConditions: [],
                securityConditions: { accessTags: ['test-access'] },
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
                securityConditions: { accessTags: ['test-access'] },
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
                securityConditions: { accessTags: ['test-access'] },
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
                securityConditions: { accessTags: ['test-access'] },
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
                securityConditions: { accessTags: ['test-access'] },
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
                securityConditions: { accessTags: ['a'] },
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
                'resource-123', schema, { accessTags: ['test-access'] }
            );
            expect(query).toContain('id = {_id:String}');
            expect(query).toContain('hasAny(access_tags');
            expect(query).toContain('LIMIT 1');
            expect(query_params._id).toBe('resource-123');
        });

        test('findByIdQuery with null security skips security filtering (wildcard access)', () => {
            const { query } = builder.buildFindByIdQuery(
                'resource-123', schema, null
            );
            expect(query).toContain('id = {_id:String}');
            expect(query).not.toContain('hasAny(access_tags');
        });

        test('findByIdQuery with empty accessTags skips security filter', () => {
            const { query, query_params } = builder.buildFindByIdQuery(
                'resource-123', schema, { accessTags: [] }
            );
            expect(query).not.toContain('access_tags');
            expect(query_params._accessTags).toBeUndefined();
        });
    });

    describe('validateRequiredFilters', () => {
        test('passes when required filter is present', () => {
            const parsed = {
                fieldConditions: [
                    { fieldPath: 'recorded', column: 'recorded', type: 'datetime', operator: '$gte', value: '2024-01-01' }
                ],
                securityConditions: { accessTags: ['test-access'] },
                paginationCursor: null
            };
            expect(() => builder.validateRequiredFilters(parsed, schema)).not.toThrow();
        });

        test('throws 400 when required filter missing', () => {
            const parsed = {
                fieldConditions: [],
                securityConditions: { accessTags: ['test-access'] },
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
                securityConditions: { accessTags: ['test-access'] },
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
                securityConditions: { accessTags: ['test-access'] },
                paginationCursor: null
            };
            expect(() => builder.validateRequiredFilters(parsed, schema)).not.toThrow();
        });

        test('skips validation when no requiredFilters defined', () => {
            const noRequiredSchema = { ...schema, requiredFilters: [] };
            const parsed = {
                fieldConditions: [],
                securityConditions: { accessTags: ['test-access'] },
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
                securityConditions: { accessTags: ['test-access'] },
                paginationCursor: null
            };
            expect(() => builder.buildSearchQuery(parsed, schema)).toThrow('Unsupported operator: $regex');
        });
    });

    describe('security enforcement', () => {
        test('empty accessTags skips security filtering (wildcard access)', () => {
            const parsed = {
                fieldConditions: [],
                securityConditions: { accessTags: [] },
                paginationCursor: null
            };
            const { query, query_params } = builder.buildSearchQuery(parsed, schema);
            expect(query).not.toContain('access_tags');
            expect(query_params._accessTags).toBeUndefined();
        });

        test('undefined accessTags skips security filtering', () => {
            const parsed = {
                fieldConditions: [],
                securityConditions: {},
                paginationCursor: null
            };
            const { query, query_params } = builder.buildSearchQuery(parsed, schema);
            expect(query).not.toContain('access_tags');
            expect(query_params._accessTags).toBeUndefined();
        });
    });

    describe('type exhaustiveness', () => {
        test('throws on unknown field type', () => {
            const parsed = {
                fieldConditions: [
                    { fieldPath: 'custom', column: 'custom', type: 'unknown_type', operator: '$eq', value: 'x' }
                ],
                securityConditions: { accessTags: ['test-access'] },
                paginationCursor: null
            };
            expect(() => builder.buildSearchQuery(parsed, schema)).toThrow("Unknown field type 'unknown_type'");
        });

        test.each([
            ['string', 'String'],
            ['reference', 'String'],
            ['lowcardinality', 'String'],
            ['datetime', 'String'],
            ['number', 'Float64']
        ])('field type %s maps to ClickHouse type %s', (fieldType, expectedChType) => {
            const parsed = {
                fieldConditions: [
                    { fieldPath: 'test', column: 'test_col', type: fieldType, operator: '$eq', value: 'x' }
                ],
                securityConditions: { accessTags: ['test-access'] },
                paginationCursor: null
            };
            const { query } = builder.buildSearchQuery(parsed, schema);
            expect(query).toContain(`test_col = {_p0:${expectedChType}}`);
        });

        test('array<string> $eq generates has()', () => {
            const parsed = {
                fieldConditions: [
                    { fieldPath: 'test', column: 'test_col', type: 'array<string>', operator: '$eq', value: 'x' }
                ],
                securityConditions: { accessTags: ['test-access'] },
                paginationCursor: null
            };
            const { query } = builder.buildSearchQuery(parsed, schema);
            expect(query).toContain('has(test_col, {_p0:String})');
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
                securityConditions: { accessTags: ['a'] },
                paginationCursor: null
            };
            const { query } = builder.buildSearchQuery(parsed, schema);
            expect(query).toContain('((status = {_p0:String} AND (code_code = {_p1:String} OR code_code = {_p2:String})) OR status = {_p3:String})');
        });

        test('malformed composite cursor (invalid JSON) falls back to id seek', () => {
            const parsed = {
                fieldConditions: [],
                securityConditions: { accessTags: ['a'] },
                paginationCursor: 'not-valid-json{'
            };
            const { query, query_params } = builder.buildSearchQuery(parsed, schema);
            expect(query).toContain('_uuid > {_sk_id:String}');
            expect(query_params._sk_id).toBe('not-valid-json{');
        });

        test('composite cursor with missing seekKey fields falls back to id seek', () => {
            const parsed = {
                fieldConditions: [],
                securityConditions: { accessTags: ['a'] },
                paginationCursor: JSON.stringify({ recorded: '2024-01-01 00:00:00' })
            };
            const { query, query_params } = builder.buildSearchQuery(parsed, schema);
            // Missing 'id' in cursor — falls back to simple id seek
            expect(query).toContain('_uuid > {_sk_id:String}');
            expect(query).not.toContain('tuple(');
        });

        test('composite cursor with SQL injection in values uses parameterized query', () => {
            const parsed = {
                fieldConditions: [],
                securityConditions: { accessTags: ['a'] },
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
                securityConditions: { accessTags: [''] },
                paginationCursor: null
            };
            // Empty string in array is technically a non-empty array — debatable
            // but matching the current behavior. The auth layer should prevent this.
            expect(() => builder.buildSearchQuery(parsed, schema)).not.toThrow();
        });

        test('count query skips security with empty accessTags (wildcard access)', () => {
            const parsed = {
                fieldConditions: [],
                securityConditions: { accessTags: [] },
                paginationCursor: null
            };
            const { query, query_params } = builder.buildCountQuery(parsed, schema);
            expect(query).not.toContain('access_tags');
            expect(query_params._accessTags).toBeUndefined();
        });

        test('condition node missing column throws', () => {
            const parsed = {
                fieldConditions: [
                    { fieldPath: 'bad', operator: '$eq', value: 'x', type: 'string' }
                ],
                securityConditions: { accessTags: ['a'] },
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
                securityConditions: { accessTags: ['a'] },
                paginationCursor: null
            };
            expect(() => builder.validateRequiredFilters(parsed, schemaWithNonRequired)).toThrow('exceeds maximum of 7 days');
        });

        test('JSON array cursor falls back to id seek (not a cursor object)', () => {
            const parsed = {
                fieldConditions: [],
                securityConditions: { accessTags: ['a'] },
                paginationCursor: JSON.stringify(['not', 'an', 'object'])
            };
            const { query } = builder.buildSearchQuery(parsed, schema);
            expect(query).toContain('_uuid > {_sk_id:String}');
        });
    });

    describe('array<string> column support', () => {
        test('$eq generates has()', () => {
            const parsed = {
                fieldConditions: [
                    { fieldPath: 'agent.who._uuid', column: 'agent_who', type: 'array<string>', operator: '$eq', value: 'Patient/123' }
                ],
                securityConditions: { accessTags: ['a'] },
                paginationCursor: null
            };
            const { query, query_params } = builder.buildSearchQuery(parsed, schema);
            expect(query).toContain('has(agent_who, {_p0:String})');
            expect(query_params._p0).toBe('Patient/123');
        });

        test('$in generates hasAny()', () => {
            const parsed = {
                fieldConditions: [
                    { fieldPath: 'agent.who._uuid', column: 'agent_who', type: 'array<string>', operator: '$in', value: ['Patient/123', 'Patient/456'] }
                ],
                securityConditions: { accessTags: ['a'] },
                paginationCursor: null
            };
            const { query, query_params } = builder.buildSearchQuery(parsed, schema);
            expect(query).toContain('hasAny(agent_who, {_p0:Array(String)})');
            expect(query_params._p0).toEqual(['Patient/123', 'Patient/456']);
        });

        test('$ne generates NOT has()', () => {
            const parsed = {
                fieldConditions: [
                    { fieldPath: 'agent.who._uuid', column: 'agent_who', type: 'array<string>', operator: '$ne', value: 'Patient/123' }
                ],
                securityConditions: { accessTags: ['a'] },
                paginationCursor: null
            };
            const { query, query_params } = builder.buildSearchQuery(parsed, schema);
            expect(query).toContain('NOT has(agent_who, {_p0:String})');
            expect(query_params._p0).toBe('Patient/123');
        });

        test('JSON path column used for array search', () => {
            const parsed = {
                fieldConditions: [
                    { fieldPath: 'agent.who._sourceId', column: 'resource.agent[].who._sourceId', type: 'array<string>', operator: '$in', value: ['Practitioner/dr-smith'] }
                ],
                securityConditions: { accessTags: ['a'] },
                paginationCursor: null
            };
            const { query, query_params } = builder.buildSearchQuery(parsed, schema);
            expect(query).toContain('hasAny(resource.agent[].who._sourceId, {_p0:Array(String)})');
            expect(query_params._p0).toEqual(['Practitioner/dr-smith']);
        });
    });

    describe('_uuid filter support', () => {
        test('$in on _uuid generates IN clause', () => {
            const parsed = {
                fieldConditions: [
                    { fieldPath: '_uuid', column: '_uuid', type: 'string', operator: '$in', value: ['uuid-1', 'uuid-2'] }
                ],
                securityConditions: { accessTags: ['test-access'] },
                paginationCursor: null
            };
            const { query, query_params } = builder.buildSearchQuery(parsed, schema);
            expect(query).toContain('_uuid IN {_p0:Array(String)}');
            expect(query_params._p0).toEqual(['uuid-1', 'uuid-2']);
        });

        test('$eq on _uuid generates equality clause', () => {
            const parsed = {
                fieldConditions: [
                    { fieldPath: '_uuid', column: '_uuid', type: 'string', operator: '$eq', value: 'uuid-1' }
                ],
                securityConditions: { accessTags: ['test-access'] },
                paginationCursor: null
            };
            const { query, query_params } = builder.buildSearchQuery(parsed, schema);
            expect(query).toContain('_uuid = {_p0:String}');
            expect(query_params._p0).toBe('uuid-1');
        });
    });

    describe('wildcard * access tag bypass', () => {
        test('skips access tag filter when accessTags contains *', () => {
            const parsed = {
                fieldConditions: [],
                securityConditions: { accessTags: ['*'] },
                paginationCursor: null
            };
            const { query, query_params } = builder.buildSearchQuery(parsed, schema);
            expect(query).not.toContain('access_tags');
            expect(query_params._accessTags).toBeUndefined();
        });
    });

    describe('AuditEvent full SQL snapshot', () => {
        let auditSchema;

        beforeEach(() => {
            const { getAuditEventClickHouseSchema } = require('../../../../dataLayer/clickHouse/auditEventClickHouseSchema');
            auditSchema = getAuditEventClickHouseSchema();
        });

        test('search by date range and action', () => {
            const parsed = {
                fieldConditions: [
                    { fieldPath: 'recorded', column: 'recorded', type: 'datetime', operator: '$gte', value: '2024-06-01T00:00:00Z' },
                    { fieldPath: 'recorded', column: 'recorded', type: 'datetime', operator: '$lt', value: '2024-06-15T00:00:00Z' },
                    { fieldPath: 'action', column: 'action', type: 'lowcardinality', operator: '$eq', value: 'R' }
                ],
                securityConditions: { accessTags: ['client-a'] },
                paginationCursor: null
            };
            const { query, query_params } = builder.buildSearchQuery(parsed, auditSchema, { limit: 10 });
            expect(query).toBe(
                'SELECT resource\n' +
                'FROM fhir.AuditEvent_4_0_0\n' +
                'WHERE recorded >= {_p0:String} AND recorded < {_p1:String} AND action = {_p2:String} AND hasAny(access_tags, {_accessTags:Array(String)})\n' +
                'ORDER BY recorded, _uuid\n' +
                'LIMIT {_limit:UInt32}'
            );
            expect(query_params).toEqual({
                _p0: '2024-06-01 00:00:00',
                _p1: '2024-06-15 00:00:00',
                _p2: 'R',
                _accessTags: ['client-a'],
                _limit: 10
            });
        });

        test('search with offset', () => {
            const parsed = {
                fieldConditions: [
                    { fieldPath: 'recorded', column: 'recorded', type: 'datetime', operator: '$gte', value: '2024-06-01T00:00:00Z' }
                ],
                securityConditions: { accessTags: ['tenant-x'] },
                paginationCursor: null
            };
            const { query, query_params } = builder.buildSearchQuery(parsed, auditSchema, { limit: 20, skip: 40 });
            expect(query).toBe(
                'SELECT resource\n' +
                'FROM fhir.AuditEvent_4_0_0\n' +
                'WHERE recorded >= {_p0:String} AND hasAny(access_tags, {_accessTags:Array(String)})\n' +
                'ORDER BY recorded, _uuid\n' +
                'LIMIT {_limit:UInt32}\n' +
                'OFFSET {_skip:UInt32}'
            );
            expect(query_params).toEqual({
                _p0: '2024-06-01 00:00:00',
                _accessTags: ['tenant-x'],
                _limit: 20,
                _skip: 40
            });
        });

        test('search by agent with _uuid cursor', () => {
            const parsed = {
                fieldConditions: [
                    { fieldPath: 'recorded', column: 'recorded', type: 'datetime', operator: '$gte', value: '2024-06-01T00:00:00Z' },
                    { fieldPath: 'recorded', column: 'recorded', type: 'datetime', operator: '$lt', value: '2024-06-30T00:00:00Z' },
                    { fieldPath: 'agent.who._uuid', column: 'agent_who', type: 'array<string>', operator: '$eq', value: 'Practitioner/pract-uuid' }
                ],
                securityConditions: { accessTags: ['client-b'] },
                paginationCursor: 'last-uuid'
            };
            const { query, query_params } = builder.buildSearchQuery(parsed, auditSchema);
            expect(query).toBe(
                'SELECT resource\n' +
                'FROM fhir.AuditEvent_4_0_0\n' +
                'WHERE recorded >= {_p0:String} AND recorded < {_p1:String} AND has(agent_who, {_p2:String}) AND hasAny(access_tags, {_accessTags:Array(String)}) AND _uuid > {_sk_id:String}\n' +
                'ORDER BY recorded, _uuid\n' +
                'LIMIT {_limit:UInt32}'
            );
            expect(query_params).toEqual({
                _p0: '2024-06-01 00:00:00',
                _p1: '2024-06-30 00:00:00',
                _p2: 'Practitioner/pract-uuid',
                _accessTags: ['client-b'],
                _sk_id: 'last-uuid',
                _limit: 100
            });
        });

        test('search by entity with hasAny', () => {
            const parsed = {
                fieldConditions: [
                    { fieldPath: 'entity.what._uuid', column: 'entity_what', type: 'array<string>', operator: '$in', value: ['Patient/p1', 'Patient/p2'] }
                ],
                securityConditions: { accessTags: ['client-a'] },
                paginationCursor: null
            };
            const { query, query_params } = builder.buildSearchQuery(parsed, auditSchema);
            expect(query).toBe(
                'SELECT resource\n' +
                'FROM fhir.AuditEvent_4_0_0\n' +
                'WHERE hasAny(entity_what, {_p0:Array(String)}) AND hasAny(access_tags, {_accessTags:Array(String)})\n' +
                'ORDER BY recorded, _uuid\n' +
                'LIMIT {_limit:UInt32}'
            );
            expect(query_params).toEqual({
                _p0: ['Patient/p1', 'Patient/p2'],
                _accessTags: ['client-a'],
                _limit: 100
            });
        });

        test('search by agent _sourceId via JSON path', () => {
            const parsed = {
                fieldConditions: [
                    { fieldPath: 'agent.who._sourceId', column: 'resource.agent[].who._sourceId', type: 'array<string>', operator: '$in', value: ['Practitioner/dr-smith'] }
                ],
                securityConditions: { accessTags: ['client-a'] },
                paginationCursor: null
            };
            const { query, query_params } = builder.buildSearchQuery(parsed, auditSchema);
            expect(query).toBe(
                'SELECT resource\n' +
                'FROM fhir.AuditEvent_4_0_0\n' +
                'WHERE hasAny(resource.agent[].who._sourceId, {_p0:Array(String)}) AND hasAny(access_tags, {_accessTags:Array(String)})\n' +
                'ORDER BY recorded, _uuid\n' +
                'LIMIT {_limit:UInt32}'
            );
            expect(query_params).toEqual({
                _p0: ['Practitioner/dr-smith'],
                _accessTags: ['client-a'],
                _limit: 100
            });
        });

        test('search with wildcard access skips security clause', () => {
            const parsed = {
                fieldConditions: [
                    { fieldPath: 'action', column: 'action', type: 'lowcardinality', operator: '$eq', value: 'C' }
                ],
                securityConditions: { accessTags: ['*'] },
                paginationCursor: null
            };
            const { query, query_params } = builder.buildSearchQuery(parsed, auditSchema);
            expect(query).toBe(
                'SELECT resource\n' +
                'FROM fhir.AuditEvent_4_0_0\n' +
                'WHERE action = {_p0:String}\n' +
                'ORDER BY recorded, _uuid\n' +
                'LIMIT {_limit:UInt32}'
            );
            expect(query_params).toEqual({
                _p0: 'C',
                _limit: 100
            });
        });

        test('count query', () => {
            const parsed = {
                fieldConditions: [
                    { fieldPath: 'recorded', column: 'recorded', type: 'datetime', operator: '$gte', value: '2024-06-01T00:00:00Z' },
                    { fieldPath: 'recorded', column: 'recorded', type: 'datetime', operator: '$lt', value: '2024-06-15T00:00:00Z' }
                ],
                securityConditions: { accessTags: ['client-a'] },
                paginationCursor: null
            };
            const { query, query_params } = builder.buildCountQuery(parsed, auditSchema);
            expect(query).toBe(
                'SELECT count() AS cnt\n' +
                'FROM fhir.AuditEvent_4_0_0\n' +
                'WHERE recorded >= {_p0:String} AND recorded < {_p1:String} AND hasAny(access_tags, {_accessTags:Array(String)})'
            );
            expect(query_params).toEqual({
                _p0: '2024-06-01 00:00:00',
                _p1: '2024-06-15 00:00:00',
                _accessTags: ['client-a']
            });
        });

        test('search by _uuid $in', () => {
            const parsed = {
                fieldConditions: [
                    { fieldPath: '_uuid', column: '_uuid', type: 'string', operator: '$in', value: ['uuid-1', 'uuid-2'] }
                ],
                securityConditions: { accessTags: ['client-a'] },
                paginationCursor: null
            };
            const { query, query_params } = builder.buildSearchQuery(parsed, auditSchema);
            expect(query).toBe(
                'SELECT resource\n' +
                'FROM fhir.AuditEvent_4_0_0\n' +
                'WHERE _uuid IN {_p0:Array(String)} AND hasAny(access_tags, {_accessTags:Array(String)})\n' +
                'ORDER BY recorded, _uuid\n' +
                'LIMIT {_limit:UInt32}'
            );
            expect(query_params).toEqual({
                _p0: ['uuid-1', 'uuid-2'],
                _accessTags: ['client-a'],
                _limit: 100
            });
        });

        test('findById', () => {
            const { query, query_params } = builder.buildFindByIdQuery(
                'ae-123', auditSchema, { accessTags: ['tenant-1'] }
            );
            expect(query).toBe(
                'SELECT resource\n' +
                'FROM fhir.AuditEvent_4_0_0\n' +
                'WHERE id = {_id:String} AND hasAny(access_tags, {_accessTags:Array(String)})\n' +
                'LIMIT 1'
            );
            expect(query_params).toEqual({
                _id: 'ae-123',
                _accessTags: ['tenant-1']
            });
        });
    });

    describe('ReplacingMergeTree queries', () => {
        let replacingSchema;

        beforeEach(() => {
            replacingSchema = {
                ...schema,
                engine: 'ReplacingMergeTree',
                versionColumn: 'meta_version_id',
                dedupKey: ['subject_reference', 'code_code', 'effective_datetime'],
                seekKey: ['subject_reference', 'code_code', 'effective_datetime', 'id']
            };
        });

        test('search wraps in subquery with LIMIT 1 BY', () => {
            const parsed = {
                fieldConditions: [
                    { fieldPath: 'status', column: 'status', type: 'lowcardinality', operator: '$eq', value: 'final' }
                ],
                securityConditions: { accessTags: ['test-access'], ownerTags: [] },
                paginationCursor: null
            };
            const { query } = builder.buildSearchQuery(parsed, replacingSchema);
            expect(query).toContain('LIMIT 1 BY subject_reference, code_code, effective_datetime');
            expect(query).toContain('meta_version_id DESC');
            expect(query).toContain('FROM (');
        });

        test('search inner query has filters, outer has seekKey ORDER BY', () => {
            const parsed = {
                fieldConditions: [
                    { fieldPath: 'status', column: 'status', type: 'lowcardinality', operator: '$eq', value: 'final' }
                ],
                securityConditions: { accessTags: ['test-access'], ownerTags: [] },
                paginationCursor: null
            };
            const { query } = builder.buildSearchQuery(parsed, replacingSchema);
            expect(query).toContain('WHERE status = {_p0:String}');
            expect(query).toContain('ORDER BY subject_reference, code_code, effective_datetime, id');
        });

        test('count wraps in subquery with LIMIT 1 BY', () => {
            const parsed = {
                fieldConditions: [],
                securityConditions: { accessTags: ['test-access'], ownerTags: [] },
                paginationCursor: null
            };
            const { query } = builder.buildCountQuery(parsed, replacingSchema);
            expect(query).toContain('SELECT count() AS cnt');
            expect(query).toContain('LIMIT 1 BY subject_reference, code_code, effective_datetime');
            expect(query).toContain('FROM (');
        });

        test('findById uses ORDER BY versionColumn DESC', () => {
            const { query } = builder.buildFindByIdQuery(
                'obs-123', replacingSchema, { accessTags: ['test-access'], ownerTags: [] }
            );
            expect(query).toContain('ORDER BY meta_version_id DESC');
            expect(query).toContain('LIMIT 1');
            expect(query).not.toContain('LIMIT 1 BY');
        });

        test('MergeTree search has no subquery or LIMIT 1 BY', () => {
            const parsed = {
                fieldConditions: [],
                securityConditions: { accessTags: ['test-access'], ownerTags: [] },
                paginationCursor: null
            };
            const { query } = builder.buildSearchQuery(parsed, schema);
            expect(query).not.toContain('LIMIT 1 BY');
            expect(query).not.toContain('FROM (');
        });
    });
});
