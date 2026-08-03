const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

const { GetMasterPatientUsageDataRunner } = require('../../../../admin/runners/getMasterPatientUsageDataRunner');
const { DatabaseQueryFactory } = require('../../../../dataLayer/databaseQueryFactory');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { MongoDatabaseManager } = require('../../../../utils/mongoDatabaseManager');
const { IdentifierSystem } = require('../../../../utils/identifierSystem');

function createMockInstance(ClassType) {
    const instance = Object.create(ClassType.prototype);
    return instance;
}

describe('GetMasterPatientUsageDataRunner', () => {
    let runner;
    let mockAdminLogger;
    let mockMongoDatabaseManager;
    let mockDatabaseQueryFactory;

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

        mockDatabaseQueryFactory = createMockInstance(DatabaseQueryFactory);
        mockDatabaseQueryFactory.createQuery = jestGlobal.fn();

        runner = new GetMasterPatientUsageDataRunner({
            databaseQueryFactory: mockDatabaseQueryFactory,
            collections: ['Observation_4_0_0'],
            csvFileName: '/tmp/test_output.csv',
            batchSize: 100,
            adminLogger: mockAdminLogger,
            mongoDatabaseManager: mockMongoDatabaseManager
        });
    });

    describe('hasUsage', () => {
        test('returns true when reference extension contains a masterPatient uuid', () => {
            runner.masterPatientUuids.add('patient-uuid-123');

            const reference = {
                extension: [
                    {
                        url: IdentifierSystem.uuid,
                        valueString: 'Patient/patient-uuid-123'
                    }
                ]
            };

            expect(runner.hasUsage({ reference })).toBe(true);
        });

        test('returns false when reference extension has non-Patient resourceType', () => {
            runner.masterPatientUuids.add('some-uuid');

            const reference = {
                extension: [
                    {
                        url: IdentifierSystem.uuid,
                        valueString: 'Practitioner/some-uuid'
                    }
                ]
            };

            expect(runner.hasUsage({ reference })).toBe(false);
        });

        test('returns false when reference has no extension', () => {
            runner.masterPatientUuids.add('patient-uuid-123');

            const reference = {};

            expect(runner.hasUsage({ reference })).toBe(false);
        });

        test('returns false when extension has no uuid entry', () => {
            runner.masterPatientUuids.add('patient-uuid-123');

            const reference = {
                extension: [
                    { url: 'some-other-url', valueString: 'Patient/patient-uuid-123' }
                ]
            };

            expect(runner.hasUsage({ reference })).toBe(false);
        });

        test('returns false when uuid is not in masterPatientUuids set', () => {
            runner.masterPatientUuids.add('different-uuid');

            const reference = {
                extension: [
                    {
                        url: IdentifierSystem.uuid,
                        valueString: 'Patient/patient-uuid-123'
                    }
                ]
            };

            expect(runner.hasUsage({ reference })).toBe(false);
        });
    });

    describe('processReference', () => {
        test('returns false for null reference', () => {
            const result = runner.processReference({
                reference: null,
                resourceType: 'Observation',
                lastUpdated: new Date(),
                uuid: 'uuid-1'
            });

            expect(result).toBe(false);
        });

        test('creates initial usage data for a resource type with master patient reference', () => {
            runner.masterPatientUuids.add('patient-uuid-123');

            const reference = {
                extension: [
                    {
                        url: IdentifierSystem.uuid,
                        valueString: 'Patient/patient-uuid-123'
                    }
                ]
            };

            const lastUpdated = new Date('2023-06-15');

            runner.processReference({
                reference,
                resourceType: 'Observation',
                lastUpdated,
                uuid: 'obs-uuid-1'
            });

            expect(runner.usageData.has('Observation')).toBe(true);
            const data = runner.usageData.get('Observation');
            expect(data.count).toBe(1);
            expect(data.minUuid).toBe('obs-uuid-1');
            expect(data.maxUuid).toBe('obs-uuid-1');
            expect(data.minLastUpdated).toEqual(lastUpdated);
            expect(data.maxlastUpdated).toEqual(lastUpdated);
        });

        test('updates usage data with newer and older timestamps', () => {
            runner.masterPatientUuids.add('patient-uuid-123');

            const reference = {
                extension: [
                    {
                        url: IdentifierSystem.uuid,
                        valueString: 'Patient/patient-uuid-123'
                    }
                ]
            };

            const date1 = new Date('2023-06-15');
            const date2 = new Date('2023-08-20');
            const date3 = new Date('2023-01-01');

            runner.processReference({ reference, resourceType: 'Observation', lastUpdated: date1, uuid: 'uuid-1' });
            runner.processReference({ reference, resourceType: 'Observation', lastUpdated: date2, uuid: 'uuid-2' });
            runner.processReference({ reference, resourceType: 'Observation', lastUpdated: date3, uuid: 'uuid-3' });

            const data = runner.usageData.get('Observation');
            expect(data.count).toBe(3);
            expect(data.maxlastUpdated).toEqual(date2);
            expect(data.maxUuid).toBe('uuid-2');
            expect(data.minLastUpdated).toEqual(date3);
            expect(data.minUuid).toBe('uuid-3');
        });

        test('BUG: throws TypeError when lastUpdated is undefined and processReference is called with hasUsage=true', () => {
            // This simulates a resource where resource.meta is undefined or resource.meta.lastUpdated is undefined.
            // In processCollectionAsync, lastUpdated comes from resource.meta?.lastUpdated which can be undefined.
            runner.masterPatientUuids.add('patient-uuid-123');

            const reference = {
                extension: [
                    {
                        url: IdentifierSystem.uuid,
                        valueString: 'Patient/patient-uuid-123'
                    }
                ]
            };

            // First call: sets up the initial entry with undefined lastUpdated
            runner.processReference({
                reference,
                resourceType: 'Observation',
                lastUpdated: undefined,
                uuid: 'uuid-1'
            });

            const data = runner.usageData.get('Observation');
            // The data is stored with undefined values for dates
            expect(data.minLastUpdated).toBeUndefined();
            expect(data.maxlastUpdated).toBeUndefined();
        });

        test('addUsageDataToCsv should handle undefined lastUpdated gracefully without throwing', async () => {
            // Setup: store usage data with undefined dates (as happens when meta.lastUpdated is missing)
            runner.usageData.set('Observation', {
                count: 1,
                minUuid: 'uuid-1',
                minLastUpdated: undefined,
                maxUuid: 'uuid-1',
                maxlastUpdated: undefined
            });

            // EXPECTED: correct behavior (will fail until bug is fixed)
            // addUsageDataToCsv should handle undefined lastUpdated gracefully
            // (e.g., use empty string or 'N/A') instead of calling toISOString() on undefined.
            await expect(runner.addUsageDataToCsv()).resolves.not.toThrow();
        });
    });

    describe('getMasterPatientUuids', () => {
        test('BUG: cursor.next() returns null after hasNext() race condition causes null dereference', async () => {
            // When cursor.hasNext() returns true but cursor.next() returns null
            // (can happen with tailable cursors or race conditions), accessing doc._uuid throws.
            const mockCursor = {
                hasNext: jestGlobal.fn()
                    .mockResolvedValueOnce(true)
                    .mockResolvedValueOnce(false),
                next: jestGlobal.fn().mockResolvedValueOnce(null)
            };

            const mockDatabaseQueryManager = {
                findAsync: jestGlobal.fn().mockResolvedValue(mockCursor)
            };

            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue(mockDatabaseQueryManager);

            // doc is null, so doc._uuid throws TypeError
            await expect(runner.getMasterPatientUuids()).rejects.toThrow();
        });

        test('successfully fetches master patient uuids', async () => {
            const mockCursor = {
                hasNext: jestGlobal.fn()
                    .mockResolvedValueOnce(true)
                    .mockResolvedValueOnce(true)
                    .mockResolvedValueOnce(false),
                next: jestGlobal.fn()
                    .mockResolvedValueOnce({ _uuid: 'uuid-1' })
                    .mockResolvedValueOnce({ _uuid: 'uuid-2' })
            };

            const mockDatabaseQueryManager = {
                findAsync: jestGlobal.fn().mockResolvedValue(mockCursor)
            };

            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue(mockDatabaseQueryManager);

            await runner.getMasterPatientUuids();

            expect(runner.masterPatientUuids.has('uuid-1')).toBe(true);
            expect(runner.masterPatientUuids.has('uuid-2')).toBe(true);
        });
    });

    describe('processCollectionAsync', () => {
        test('BUG: cursor.nextObject() returns null causes TypeError on resource.updateReferencesAsync', async () => {
            // If cursor.nextObject() returns null after hasNext() returns true,
            // line 201 tries resource.updateReferencesAsync() on null
            const mockCursor = {
                hasNext: jestGlobal.fn()
                    .mockResolvedValueOnce(true)
                    .mockResolvedValueOnce(false),
                nextObject: jestGlobal.fn().mockResolvedValueOnce(null)
            };

            const mockDatabaseQueryManager = {
                findAsync: jestGlobal.fn().mockResolvedValue(mockCursor)
            };

            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue(mockDatabaseQueryManager);

            await expect(
                runner.processCollectionAsync({ collectionName: 'Observation_4_0_0' })
            ).rejects.toThrow();
        });

        test('processes resource references correctly', async () => {
            const mockResource = {
                meta: { lastUpdated: new Date('2023-01-01') },
                _uuid: 'res-uuid-1',
                updateReferencesAsync: jestGlobal.fn().mockResolvedValue(undefined)
            };

            const mockCursor = {
                hasNext: jestGlobal.fn()
                    .mockResolvedValueOnce(true)
                    .mockResolvedValueOnce(false),
                nextObject: jestGlobal.fn().mockResolvedValueOnce(mockResource)
            };

            const mockDatabaseQueryManager = {
                findAsync: jestGlobal.fn().mockResolvedValue(mockCursor)
            };

            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue(mockDatabaseQueryManager);

            await runner.processCollectionAsync({ collectionName: 'Observation_4_0_0' });

            expect(mockResource.updateReferencesAsync).toHaveBeenCalledTimes(1);
        });
    });
});
