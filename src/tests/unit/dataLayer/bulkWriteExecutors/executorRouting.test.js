'use strict';

const { describe, test, beforeEach, expect, jest: jestGlobal } = require('@jest/globals');
const { ClickHouseBulkWriteExecutor } = require('../../../../dataLayer/bulkWriteExecutors/clickHouseBulkWriteExecutor');
const { ClickHouseSchemaRegistry } = require('../../../../dataLayer/clickHouse/schemaRegistry');
const {
    WRITE_STRATEGIES,
    ENGINE_TYPES,
    RESOURCE_COLUMN_TYPES
} = require('../../../../constants/clickHouseConstants');

/**
 * Tests that executor routing works correctly:
 * - Mongo resources do NOT match ClickHouseBulkWriteExecutor
 * - Only registered ClickHouse resources match
 * - Simulates the dispatcher pattern from DatabaseBulkInserter
 */
describe('Executor routing', () => {
    let schemaRegistry;
    let clickHouseExecutor;

    beforeEach(() => {
        schemaRegistry = new ClickHouseSchemaRegistry();
        schemaRegistry.registerSchema('ScaffoldingTestResource', {
            tableName: 'fhir.fhir_scaffolding_test',
            engine: ENGINE_TYPES.MERGE_TREE,
            versionColumn: null,
            dedupKey: null,
            seekKey: ['recorded', 'id'],
            fhirResourceColumn: '_fhir_resource',
            fhirResourceColumnType: RESOURCE_COLUMN_TYPES.STRING,
            fieldMappings: {
                recorded: { column: 'recorded', type: 'datetime' }
            },
            securityMappings: {
                accessTags: 'access_tags',
                sourceAssigningAuthority: 'source_assigning_authority'
            },
            requiredFilters: [],
            maxRangeDays: null,
            writeStrategy: WRITE_STRATEGIES.SYNC_DIRECT,
            fireChangeEvents: false,
            fieldExtractor: { extract: () => ({}) }
        });

        clickHouseExecutor = new ClickHouseBulkWriteExecutor({
            genericClickHouseRepository: { insertAsync: jestGlobal.fn() },
            schemaRegistry,
            postSaveProcessor: { afterSaveAsync: jestGlobal.fn() }
        });
    });

    describe('ClickHouseBulkWriteExecutor.canHandle', () => {
        test('returns true for registered SYNC_DIRECT resource', () => {
            expect(clickHouseExecutor.canHandle('ScaffoldingTestResource')).toBe(true);
        });

        test.each([
            'Patient',
            'Practitioner',
            'Observation',
            'AuditEvent',
            'Group',
            'Condition',
            'MedicationRequest',
            'DocumentReference',
            'Encounter'
        ])('returns false for %s (not in schema registry)', (resourceType) => {
            expect(clickHouseExecutor.canHandle(resourceType)).toBe(false);
        });
    });

    describe('dispatcher simulation', () => {
        test('Mongo catch-all only reached when ClickHouse executor declines', () => {
            // Simulate the executor array: [clickHouseExecutor, mongoCatchAll]
            const mongoCatchAll = { canHandle: () => true };
            const executors = [clickHouseExecutor, mongoCatchAll];

            // Patient: CH declines, Mongo catches
            const patientExecutor = executors.find(e => e.canHandle('Patient'));
            expect(patientExecutor).toBe(mongoCatchAll);

            // ScaffoldingTestResource: CH claims it
            const testExecutor = executors.find(e => e.canHandle('ScaffoldingTestResource'));
            expect(testExecutor).toBe(clickHouseExecutor);
        });

        test('no resource type matches both executors (CH is specific, Mongo is catch-all)', () => {
            // If CH claims a resource, Mongo should NOT be reached via Array.find
            const mongoCatchAll = { canHandle: () => true };
            const executors = [clickHouseExecutor, mongoCatchAll];

            // For the CH resource, find() returns CH executor (first match wins)
            const executor = executors.find(e => e.canHandle('ScaffoldingTestResource'));
            expect(executor).toBe(clickHouseExecutor);
            expect(executor).not.toBe(mongoCatchAll);
        });

        test('empty schema registry means all resources go to Mongo catch-all', () => {
            const emptyRegistry = new ClickHouseSchemaRegistry();
            const emptyChExecutor = new ClickHouseBulkWriteExecutor({
                genericClickHouseRepository: { insertAsync: jestGlobal.fn() },
                schemaRegistry: emptyRegistry,
                postSaveProcessor: { afterSaveAsync: jestGlobal.fn() }
            });

            const mongoCatchAll = { canHandle: () => true };
            const executors = [emptyChExecutor, mongoCatchAll];

            // Every resource type should fall through to Mongo
            expect(executors.find(e => e.canHandle('Patient'))).toBe(mongoCatchAll);
            expect(executors.find(e => e.canHandle('Observation'))).toBe(mongoCatchAll);
            expect(executors.find(e => e.canHandle('AuditEvent'))).toBe(mongoCatchAll);
        });
    });
});
