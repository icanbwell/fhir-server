const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

// Mock AdminPersonPatientDataManager to avoid deep dependency chain (openid-client ESM)
jestGlobal.mock('../../../../admin/adminPersonPatientDataManager', () => {
    class AdminPersonPatientDataManager {
        async deletePersonDataGraphAsync () { return { entry: [] }; }
        async deletePatientDataGraphAsync () { return { entry: [] }; }
    }
    return { AdminPersonPatientDataManager };
});

const { DeletePersonPatientDataGraphRunner } = require('../../../../admin/runners/deletePersonPatientDataGraphRunner');
const { AdminPersonPatientDataManager } = require('../../../../admin/adminPersonPatientDataManager');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { MongoDatabaseManager } = require('../../../../utils/mongoDatabaseManager');

function createMockInstance(ClassType) {
    return Object.create(ClassType.prototype);
}

describe('DeletePersonPatientDataGraphRunner', () => {
    let runner;
    let mockAdminLogger;
    let mockMongoDatabaseManager;
    let mockAdminPersonPatientDataManager;

    beforeEach(() => {
        mockAdminLogger = createMockInstance(AdminLogger);
        mockAdminLogger.logInfo = jestGlobal.fn();
        mockAdminLogger.logError = jestGlobal.fn();

        mockMongoDatabaseManager = createMockInstance(MongoDatabaseManager);
        mockMongoDatabaseManager.getClientConfigAsync = jestGlobal.fn().mockResolvedValue({
            connection: 'mongodb://localhost:27017',
            db_name: 'test_db',
            options: {}
        });

        mockAdminPersonPatientDataManager = createMockInstance(AdminPersonPatientDataManager);
        mockAdminPersonPatientDataManager.deletePersonDataGraphAsync = jestGlobal.fn();
        mockAdminPersonPatientDataManager.deletePatientDataGraphAsync = jestGlobal.fn();

        runner = new DeletePersonPatientDataGraphRunner({
            batchSize: 10,
            adminLogger: mockAdminLogger,
            mongoDatabaseManager: mockMongoDatabaseManager,
            adminPersonPatientDataManager: mockAdminPersonPatientDataManager,
            properties: ['resourceType', '_uuid'],
            patientUuids: [],
            personUuids: [],
            concurrencyBatchSize: 2,
            dryRun: false
        });
    });

    // =====================================================
    // Tests for getProjection
    // =====================================================
    describe('getProjection', () => {
        test('includes specified properties and needed properties', () => {
            const projection = runner.getProjection();
            expect(projection.resourceType).toBe(1);
            expect(projection._uuid).toBe(1);
            expect(projection._sourceId).toBe(1);
            expect(projection._sourceAssigningAuthority).toBe(1);
        });

        test('includes custom properties', () => {
            runner.properties = ['name', 'telecom'];
            const projection = runner.getProjection();
            expect(projection.name).toBe(1);
            expect(projection.telecom).toBe(1);
            // always includes needed properties
            expect(projection.resourceType).toBe(1);
            expect(projection._uuid).toBe(1);
        });
    });

    // =====================================================
    // Tests for processRecordAsync - BUG: null dereference when bundleEntries is undefined
    // =====================================================
    describe('processRecordAsync', () => {
        test('BUG: crashes with TypeError when resource type is neither Person nor Patient', async () => {
            // If processRecordAsync is called with a resource type that is neither 'Person' nor 'Patient',
            // bundleEntries is never assigned (stays undefined), and line 162 accesses
            // bundleEntries.entry?.length which throws TypeError: Cannot read properties of undefined
            await expect(async () => {
                await runner.processRecordAsync('some-uuid', 'Observation');
            }).rejects.toThrow(TypeError);
        });

        test('processes Person resource successfully with entries', async () => {
            mockAdminPersonPatientDataManager.deletePersonDataGraphAsync.mockResolvedValue({
                entry: [
                    {
                        resource: { resourceType: 'Person' },
                        request: { method: 'DELETE' }
                    },
                    {
                        resource: { resourceType: 'Patient' },
                        request: { method: 'DELETE' }
                    }
                ]
            });

            await runner.processRecordAsync('person-uuid-1', 'Person');

            expect(mockAdminPersonPatientDataManager.deletePersonDataGraphAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    personId: 'person-uuid-1',
                    method: 'DELETE'
                })
            );
            expect(runner.resourceDeletedCount.get('Person')).toBe(1);
            expect(runner.resourceDeletedCount.get('Patient')).toBe(1);
        });

        test('processes Patient resource successfully with entries', async () => {
            mockAdminPersonPatientDataManager.deletePatientDataGraphAsync.mockResolvedValue({
                entry: [
                    {
                        resource: { resourceType: 'Observation' },
                        request: { method: 'DELETE' }
                    }
                ]
            });

            await runner.processRecordAsync('patient-uuid-1', 'Patient');

            expect(mockAdminPersonPatientDataManager.deletePatientDataGraphAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    patientId: 'patient-uuid-1',
                    method: 'DELETE'
                })
            );
            expect(runner.resourceDeletedCount.get('Observation')).toBe(1);
        });

        test('handles empty entry array', async () => {
            mockAdminPersonPatientDataManager.deletePersonDataGraphAsync.mockResolvedValue({
                entry: []
            });

            await runner.processRecordAsync('person-uuid-1', 'Person');

            expect(mockAdminLogger.logInfo).toHaveBeenCalledWith(
                expect.stringContaining("doesn't exists")
            );
        });

        test('handles null entry field', async () => {
            mockAdminPersonPatientDataManager.deletePersonDataGraphAsync.mockResolvedValue({
                entry: null
            });

            // entry?.length evaluates to undefined (falsy), so goes to else branch
            await runner.processRecordAsync('person-uuid-1', 'Person');

            expect(mockAdminLogger.logInfo).toHaveBeenCalledWith(
                expect.stringContaining("doesn't exists")
            );
        });

        test('counts PATCH operations in resourceUpdatedCount', async () => {
            mockAdminPersonPatientDataManager.deletePersonDataGraphAsync.mockResolvedValue({
                entry: [
                    {
                        resource: { resourceType: 'Person' },
                        request: { method: 'PATCH' }
                    }
                ]
            });

            await runner.processRecordAsync('person-uuid-1', 'Person');

            expect(runner.resourceUpdatedCount.get('Person')).toBe(1);
            expect(runner.resourceDeletedCount.has('Person')).toBe(false);
        });

        test('BUG: crashes when bundleEntries returned is undefined (deletePersonDataGraphAsync returns undefined)', async () => {
            // If the data manager method returns undefined instead of an object with entry
            mockAdminPersonPatientDataManager.deletePersonDataGraphAsync.mockResolvedValue(undefined);

            // Line 162: bundleEntries.entry?.length - TypeError on undefined
            await expect(async () => {
                await runner.processRecordAsync('person-uuid-1', 'Person');
            }).rejects.toThrow(TypeError);
        });

        test('uses READ method in dryRun mode', async () => {
            // Create a dryRun runner
            const dryRunner = new DeletePersonPatientDataGraphRunner({
                batchSize: 10,
                adminLogger: mockAdminLogger,
                mongoDatabaseManager: mockMongoDatabaseManager,
                adminPersonPatientDataManager: mockAdminPersonPatientDataManager,
                properties: ['resourceType'],
                patientUuids: [],
                personUuids: [],
                concurrencyBatchSize: 2,
                dryRun: true
            });

            mockAdminPersonPatientDataManager.deletePersonDataGraphAsync.mockResolvedValue({
                entry: [
                    {
                        resource: { resourceType: 'Person' },
                        request: { method: 'READ' }
                    }
                ]
            });

            await dryRunner.processRecordAsync('person-uuid-1', 'Person');

            expect(mockAdminPersonPatientDataManager.deletePersonDataGraphAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    method: 'READ'
                })
            );
            // In dryRun mode, all entries are counted as deleted regardless of method
            expect(dryRunner.resourceDeletedCount.get('Person')).toBe(1);
        });
    });

    // =====================================================
    // Tests for processAsync
    // =====================================================
    describe('processAsync', () => {
        test('processes personUuids and patientUuids', async () => {
            runner.personUuids = ['person-1', 'person-2'];
            runner.patientUuids = ['patient-1'];
            runner.shutdown = jestGlobal.fn().mockResolvedValue(undefined);

            mockAdminPersonPatientDataManager.deletePersonDataGraphAsync.mockResolvedValue({
                entry: [{ resource: { resourceType: 'Person' }, request: { method: 'DELETE' } }]
            });
            mockAdminPersonPatientDataManager.deletePatientDataGraphAsync.mockResolvedValue({
                entry: [{ resource: { resourceType: 'Patient' }, request: { method: 'DELETE' } }]
            });

            await runner.processAsync();

            expect(mockAdminPersonPatientDataManager.deletePersonDataGraphAsync).toHaveBeenCalledTimes(2);
            expect(mockAdminPersonPatientDataManager.deletePatientDataGraphAsync).toHaveBeenCalledTimes(1);
            expect(runner.shutdown).toHaveBeenCalled();
        });

        test('catches and logs errors', async () => {
            runner.personUuids = ['person-1'];
            runner.patientUuids = [];

            mockAdminPersonPatientDataManager.deletePersonDataGraphAsync.mockRejectedValue(
                new Error('DB connection failed')
            );

            await runner.processAsync();

            expect(mockAdminLogger.logError).toHaveBeenCalledWith(
                expect.stringContaining('DB connection failed')
            );
        });

        test('processes in batches based on concurrencyBatchSize', async () => {
            runner.personUuids = ['p1', 'p2', 'p3', 'p4', 'p5'];
            runner.patientUuids = [];
            runner.concurrencyBatchSize = 2;
            runner.shutdown = jestGlobal.fn().mockResolvedValue(undefined);

            mockAdminPersonPatientDataManager.deletePersonDataGraphAsync.mockResolvedValue({
                entry: []
            });

            await runner.processAsync();

            // All 5 should have been processed
            expect(mockAdminPersonPatientDataManager.deletePersonDataGraphAsync).toHaveBeenCalledTimes(5);
        });
    });
});
