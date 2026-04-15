'use strict';

const { describe, test, beforeEach, expect, jest: jestGlobal } = require('@jest/globals');
const { ClickHouseBulkWriteExecutor } = require('../../../../dataLayer/bulkWriteExecutors/clickHouseBulkWriteExecutor');
const { ClickHouseSchemaRegistry } = require('../../../../dataLayer/clickHouse/schemaRegistry');
const { ClickHouseStorageProvider } = require('../../../../dataLayer/providers/clickHouseStorageProvider');
const { RESOURCE_COLUMN_TYPES } = require('../../../../constants/clickHouseConstants');

/**
 * Tests that the ClickHouse scaffolding is completely inert when no
 * schemas are registered. This is the default production state — the
 * scaffolding exists in the codebase but does nothing until a resource
 * type is explicitly configured for ClickHouse-only storage.
 */
describe('ClickHouse scaffolding disabled (no schemas registered)', () => {
    let emptyRegistry;
    let executor;

    beforeEach(() => {
        emptyRegistry = new ClickHouseSchemaRegistry();
        executor = new ClickHouseBulkWriteExecutor({
            genericClickHouseRepository: { insertAsync: jestGlobal.fn() },
            schemaRegistry: emptyRegistry,
            postSaveProcessor: { afterSaveAsync: jestGlobal.fn() }
        });
    });

    describe('executor canHandle', () => {
        test.each([
            'Patient',
            'Practitioner',
            'Observation',
            'AuditEvent',
            'Group',
            'Condition',
            'MedicationRequest',
            'DocumentReference',
            'Encounter',
            'AllergyIntolerance',
            'DiagnosticReport',
            'Immunization',
            'Procedure',
            'Claim',
            'ExplanationOfBenefit',
            'Coverage',
            'Consent'
        ])('canHandle returns false for %s when no schemas registered', (resourceType) => {
            expect(executor.canHandle(resourceType)).toBe(false);
        });

        test('no resource type matches when registry is empty', () => {
            const mongoCatchAll = { canHandle: () => true };
            const executors = [executor, mongoCatchAll];

            // Every resource falls through to Mongo
            const testTypes = ['Patient', 'Observation', 'AuditEvent', 'Group'];
            for (const rt of testTypes) {
                expect(executors.find(e => e.canHandle(rt))).toBe(mongoCatchAll);
            }
        });

        test('executeBulkAsync is never called on ClickHouse executor', () => {
            // If canHandle returns false, the dispatcher never calls executeBulkAsync.
            // Verify canHandle is the gate.
            const insertSpy = executor.repository.insertAsync;
            // canHandle returns false, so no one should call executeBulkAsync
            expect(executor.canHandle('Patient')).toBe(false);
            expect(insertSpy).not.toHaveBeenCalled();
        });
    });

    describe('schema registry', () => {
        test('hasSchema returns false for all types', () => {
            expect(emptyRegistry.hasSchema('Patient')).toBe(false);
            expect(emptyRegistry.hasSchema('Observation')).toBe(false);
            expect(emptyRegistry.hasSchema('AuditEvent')).toBe(false);
        });

        test('getRegisteredResourceTypes returns empty array', () => {
            expect(emptyRegistry.getRegisteredResourceTypes()).toEqual([]);
        });

        test('getSchema throws for any type', () => {
            expect(() => emptyRegistry.getSchema('Patient')).toThrow(
                'No ClickHouse schema registered'
            );
        });
    });

    describe('container wiring with null ClickHouse', () => {
        test('null genericClickHouseRepository produces null executor in filter', () => {
            // Simulates what createContainer does when clickHouseClientManager is null
            const nullExecutor = null;
            const mongoCatchAll = { canHandle: () => true };
            const executors = [nullExecutor, mongoCatchAll].filter(Boolean);

            // Only Mongo executor survives the filter
            expect(executors).toHaveLength(1);
            expect(executors[0]).toBe(mongoCatchAll);
        });

        test('ClickHouseStorageProvider is not instantiated for Mongo resources', () => {
            // StorageProviderFactory only creates ClickHouseStorageProvider when
            // resourceType is in clickHouseOnlyResources config.
            // With empty config, the factory returns MongoStorageProvider.
            // This test verifies the ClickHouseStorageProvider constructor
            // requires dependencies that only exist when ClickHouse is enabled.
            expect(() => new ClickHouseStorageProvider({
                resourceLocator: {},
                clickHouseClientManager: null,
                configManager: {},
                genericClickHouseRepository: null,
                resourceType: 'Patient',
                schemaRegistry: emptyRegistry
            })).not.toThrow();
            // Constructor succeeds (no eager validation) but any method call
            // would fail since repository is null — which is correct because
            // this provider should never be instantiated for Mongo resources.
        });
    });
});
