'use strict';

const { describe, test, beforeEach, expect } = require('@jest/globals');
const { ClickHouseSchemaRegistry } = require('../../../../dataLayer/clickHouse/schemaRegistry');
const {
    WRITE_STRATEGIES,
    ENGINE_TYPES,
    RESOURCE_COLUMN_TYPES
} = require('../../../../constants/clickHouseConstants');

describe('ClickHouseSchemaRegistry', () => {
    let registry;
    let validSchema;

    beforeEach(() => {
        registry = new ClickHouseSchemaRegistry();
        validSchema = {
            tableName: 'fhir.fhir_test_resource',
            engine: ENGINE_TYPES.MERGE_TREE,
            versionColumn: null,
            dedupKey: null,
            seekKey: ['recorded', 'id'],
            fhirResourceColumn: '_fhir_resource',
            fhirResourceColumnType: RESOURCE_COLUMN_TYPES.STRING,
            fieldMappings: {
                recorded: { column: 'recorded', type: 'datetime' },
                code: { column: 'code', type: 'string' }
            },
            securityMappings: {
                accessTags: 'access_tags',
                ownerTags: 'owner_tags',
                sourceAssigningAuthority: 'source_assigning_authority'
            },
            requiredFilters: ['recorded'],
            maxRangeDays: 30,
            writeStrategy: WRITE_STRATEGIES.SYNC_DIRECT,
            fireChangeEvents: true,
            fieldExtractor: { extract: () => ({}) }
        };
    });

    describe('registerSchema and getSchema', () => {
        test('registers and retrieves a valid schema', () => {
            registry.registerSchema('TestResource', validSchema);
            const schema = registry.getSchema('TestResource');
            expect(schema.tableName).toBe('fhir.fhir_test_resource');
            expect(schema.resourceType).toBe('TestResource');
        });

        test('getSchema throws for unregistered resource type', () => {
            expect(() => registry.getSchema('Unknown')).toThrow(
                'No ClickHouse schema registered for resourceType=Unknown'
            );
        });

        test('registered schema is frozen', () => {
            registry.registerSchema('TestResource', validSchema);
            const schema = registry.getSchema('TestResource');
            expect(() => { schema.tableName = 'hacked'; }).toThrow();
        });
    });

    describe('hasSchema', () => {
        test('returns true for registered resource type', () => {
            registry.registerSchema('TestResource', validSchema);
            expect(registry.hasSchema('TestResource')).toBe(true);
        });

        test('returns false for unregistered resource type', () => {
            expect(registry.hasSchema('Unknown')).toBe(false);
        });
    });

    describe('getRegisteredResourceTypes', () => {
        test('returns empty array when nothing registered', () => {
            expect(registry.getRegisteredResourceTypes()).toEqual([]);
        });

        test('returns all registered types', () => {
            registry.registerSchema('TypeA', validSchema);
            registry.registerSchema('TypeB', { ...validSchema, tableName: 'fhir.type_b' });
            expect(registry.getRegisteredResourceTypes()).toEqual(['TypeA', 'TypeB']);
        });
    });

    describe('startup validation', () => {
        test.each([
            ['tableName', { tableName: '' }, 'tableName must match pattern'],
            ['tableName null', { tableName: null }, 'tableName must match pattern'],
            ['tableName no dot', { tableName: 'nodot' }, 'tableName must match pattern'],
            ['tableName injection', { tableName: 'fhir.test; DROP TABLE' }, 'tableName must match pattern'],
            ['engine invalid', { engine: 'InvalidEngine' }, 'engine must be one of'],
            ['seekKey empty', { seekKey: [] }, 'seekKey must be a non-empty array'],
            ['seekKey not array', { seekKey: 'bad' }, 'seekKey must be a non-empty array'],
            ['fhirResourceColumn empty', { fhirResourceColumn: '' }, 'fhirResourceColumn must be a valid column name'],
            ['fhirResourceColumn injection', { fhirResourceColumn: 'col; DROP' }, 'fhirResourceColumn must be a valid column name'],
            ['fhirResourceColumnType invalid', { fhirResourceColumnType: 'binary' }, 'fhirResourceColumnType must be one of'],
            ['securityMappings missing accessTags', {
                securityMappings: { ownerTags: 'o', sourceAssigningAuthority: 's' }
            }, 'securityMappings must have accessTags'],
            ['securityMappings null', { securityMappings: null }, 'securityMappings must have accessTags'],
            ['fieldMappings null', { fieldMappings: null }, 'fieldMappings must be an object'],
            ['writeStrategy invalid', { writeStrategy: 'bad' }, 'writeStrategy must be one of'],
            ['fieldExtractor missing extract', { fieldExtractor: {} }, 'fieldExtractor must have an extract'],
            ['fieldExtractor null', { fieldExtractor: null }, 'fieldExtractor must have an extract']
        ])('rejects schema with invalid %s', (_label, override, expectedMsg) => {
            const badSchema = { ...validSchema, ...override };
            expect(() => registry.registerSchema('Bad', badSchema)).toThrow(expectedMsg);
        });

        test('rejects ReplacingMergeTree (not yet supported)', () => {
            const schema = { ...validSchema, engine: ENGINE_TYPES.REPLACING_MERGE_TREE };
            expect(() => registry.registerSchema('Bad', schema)).toThrow('not yet supported');
        });

        test('rejects requiredFilter not in fieldMappings', () => {
            const schema = { ...validSchema, requiredFilters: ['nonexistent'] };
            expect(() => registry.registerSchema('Bad', schema)).toThrow(
                "requiredFilter 'nonexistent' not found in fieldMappings"
            );
        });

        test('accepts valid schema with all fields', () => {
            expect(() => registry.registerSchema('Good', validSchema)).not.toThrow();
        });

        test('accepts schema with json fhirResourceColumnType', () => {
            const schema = { ...validSchema, fhirResourceColumnType: RESOURCE_COLUMN_TYPES.JSON };
            expect(() => registry.registerSchema('JsonCol', schema)).not.toThrow();
        });
    });
});
