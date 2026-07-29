const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

const { ChangeSourceAssigningAuthorityRunner } = require('../../../../admin/runners/changeSourceAssigningAuthorityRunner');
const { PreSaveManager } = require('../../../../preSaveHandlers/preSave');
const { DatabaseQueryFactory } = require('../../../../dataLayer/databaseQueryFactory');
const { ResourceLocatorFactory } = require('../../../../operations/common/resourceLocatorFactory');
const { ResourceMerger } = require('../../../../operations/common/resourceMerger');
const { SearchParametersManager } = require('../../../../searchParameters/searchParametersManager');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { MongoDatabaseManager } = require('../../../../utils/mongoDatabaseManager');
const { SecurityTagSystem } = require('../../../../utils/securityTagSystem');

function createMockInstance(ClassType) {
    const instance = Object.create(ClassType.prototype);
    return instance;
}

describe('ChangeSourceAssigningAuthorityRunner', () => {
    let runner;
    let mockAdminLogger;
    let mockMongoDatabaseManager;
    let mockPreSaveManager;
    let mockDatabaseQueryFactory;
    let mockResourceLocatorFactory;
    let mockResourceMerger;
    let mockSearchParametersManager;

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
        mockMongoDatabaseManager.getResourceHistoryConfigAsync = jestGlobal.fn().mockResolvedValue({
            connection: 'mongodb://localhost:27017',
            db_name: 'test_db',
            options: {}
        });
        mockMongoDatabaseManager.createClientAsync = jestGlobal.fn();

        mockPreSaveManager = createMockInstance(PreSaveManager);
        mockPreSaveManager.preSaveAsync = jestGlobal.fn().mockResolvedValue(undefined);

        mockDatabaseQueryFactory = createMockInstance(DatabaseQueryFactory);
        mockDatabaseQueryFactory.createQuery = jestGlobal.fn();

        mockResourceLocatorFactory = createMockInstance(ResourceLocatorFactory);
        mockResourceLocatorFactory.createResourceLocator = jestGlobal.fn().mockReturnValue({
            getCollectionName: () => 'Patient_4_0_0'
        });

        mockResourceMerger = createMockInstance(ResourceMerger);
        mockSearchParametersManager = createMockInstance(SearchParametersManager);
        mockSearchParametersManager.getSearchParametersForResource = jestGlobal.fn().mockReturnValue({});

        runner = new ChangeSourceAssigningAuthorityRunner({
            oldSourceAssigningAuthority: 'oldAuth',
            newSourceAssigningAuthority: 'newAuth',
            collections: ['Person_4_0_0'],
            batchSize: 100,
            referenceBatchSize: 100,
            collectionConcurrency: 3,
            adminLogger: mockAdminLogger,
            mongoDatabaseManager: mockMongoDatabaseManager,
            preSaveManager: mockPreSaveManager,
            afterLastUpdatedDate: undefined,
            beforeLastUpdatedDate: undefined,
            databaseQueryFactory: mockDatabaseQueryFactory,
            startFromCollection: undefined,
            resourceLocatorFactory: mockResourceLocatorFactory,
            proaCollections: ['Person_4_0_0'],
            limit: undefined,
            properties: undefined,
            resourceMerger: mockResourceMerger,
            useTransaction: undefined,
            skip: undefined,
            filterToRecordsWithFields: undefined,
            startFromId: undefined,
            searchParametersManager: mockSearchParametersManager
        });
    });

    describe('updateRecordAsync', () => {
        test('updates security tag code from old to new sourceAssigningAuthority', async () => {
            const resource = {
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'oldAuth' },
                        { system: SecurityTagSystem.access, code: 'someAccess' }
                    ]
                },
                updateReferencesAsync: jestGlobal.fn().mockResolvedValue(undefined)
            };

            Object.defineProperty(runner, 'requestInfo', { get: () => ({}), configurable: true });
            mockPreSaveManager.preSaveAsync = jestGlobal.fn().mockResolvedValue(resource);

            const result = await runner.updateRecordAsync(resource);

            expect(result.meta.security[0].code).toBe('newAuth');
            expect(result.meta.security[1].code).toBe('someAccess');
        });

        test('does not crash when resource.meta is undefined', async () => {
            const resource = {
                meta: undefined,
                updateReferencesAsync: jestGlobal.fn().mockResolvedValue(undefined)
            };

            Object.defineProperty(runner, 'requestInfo', { get: () => ({}), configurable: true });
            mockPreSaveManager.preSaveAsync = jestGlobal.fn().mockResolvedValue(resource);

            const result = await runner.updateRecordAsync(resource);
            expect(result).toBe(resource);
        });

        test('does not crash when resource.meta.security is undefined', async () => {
            const resource = {
                meta: {},
                updateReferencesAsync: jestGlobal.fn().mockResolvedValue(undefined)
            };

            Object.defineProperty(runner, 'requestInfo', { get: () => ({}), configurable: true });
            mockPreSaveManager.preSaveAsync = jestGlobal.fn().mockResolvedValue(resource);

            const result = await runner.updateRecordAsync(resource);
            expect(result).toBe(resource);
        });

        test('handles reference with no _sourceAssigningAuthority and no reference.reference', async () => {
            const resource = {
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'unchanged' }
                    ]
                },
                updateReferencesAsync: jestGlobal.fn().mockImplementation(async ({ fnUpdateReferenceAsync }) => {
                    // Call with a reference that has no .reference field
                    await fnUpdateReferenceAsync({ _sourceAssigningAuthority: 'oldAuth' });
                })
            };

            Object.defineProperty(runner, 'requestInfo', { get: () => ({}), configurable: true });
            mockPreSaveManager.preSaveAsync = jestGlobal.fn().mockResolvedValue(resource);

            // Should not throw - the optional chaining on reference?.reference guards this
            const result = await runner.updateRecordAsync(resource);
            expect(result).toBe(resource);
        });
    });

    describe('getQueryForResource', () => {
        test('builds correct query for non-history collection', () => {
            const query = runner.getQueryForResource(false);

            expect(query).toEqual({
                'meta.security': {
                    $elemMatch: {
                        system: SecurityTagSystem.owner,
                        code: 'oldAuth'
                    }
                }
            });
        });

        test('builds correct query for history collection', () => {
            const query = runner.getQueryForResource(true);

            expect(query).toEqual({
                'resource.meta.security': {
                    $elemMatch: {
                        system: SecurityTagSystem.owner,
                        code: 'oldAuth'
                    }
                }
            });
        });
    });

    describe('getQueryFromParameters - startFromId bug', () => {
        test('startFromId with existing query should preserve date filters alongside _id filter', () => {
            // Setup runner with both afterLastUpdatedDate and startFromId
            const runnerWithStartFromId = new ChangeSourceAssigningAuthorityRunner({
                oldSourceAssigningAuthority: 'oldAuth',
                newSourceAssigningAuthority: 'newAuth',
                collections: ['Person_4_0_0'],
                batchSize: 100,
                referenceBatchSize: 100,
                collectionConcurrency: 3,
                adminLogger: mockAdminLogger,
                mongoDatabaseManager: mockMongoDatabaseManager,
                preSaveManager: mockPreSaveManager,
                afterLastUpdatedDate: new Date('2023-01-01'),
                beforeLastUpdatedDate: undefined,
                databaseQueryFactory: mockDatabaseQueryFactory,
                startFromCollection: undefined,
                resourceLocatorFactory: mockResourceLocatorFactory,
                proaCollections: ['Person_4_0_0'],
                limit: undefined,
                properties: undefined,
                resourceMerger: mockResourceMerger,
                useTransaction: undefined,
                skip: undefined,
                filterToRecordsWithFields: undefined,
                startFromId: 'someStartId',
                searchParametersManager: mockSearchParametersManager
            });

            const query = runnerWithStartFromId.getQueryFromParameters({ queryPrefix: '' });

            // EXPECTED: correct behavior (will fail until bug is fixed)
            // Object.keys(query) > 0 always evaluates to false because it compares
            // an array to a number. The fix should use Object.keys(query).length > 0.
            // Correct behavior: both date filter AND _id filter are preserved via $and.
            expect(query.$and).toBeDefined();
            expect(query.$and).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ _id: { $gte: 'someStartId' } })
                ])
            );
        });
    });

    describe('processAsync', () => {
        test('handles empty collections array without error', async () => {
            runner.collections = [];
            runner.init = jestGlobal.fn().mockResolvedValue(undefined);
            runner.shutdown = jestGlobal.fn().mockResolvedValue(undefined);

            await runner.processAsync();

            // Should not throw; init is still called
            expect(runner.init).toHaveBeenCalled();
        });
    });
});
