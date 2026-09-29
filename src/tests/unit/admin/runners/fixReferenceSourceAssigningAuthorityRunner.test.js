const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

const { FixReferenceSourceAssigningAuthorityRunner } = require('../../../../admin/runners/fixReferenceSourceAssigningAuthorityRunner');
const { PreSaveManager } = require('../../../../preSaveHandlers/preSave');
const { DatabaseQueryFactory } = require('../../../../dataLayer/databaseQueryFactory');
const { ResourceLocatorFactory } = require('../../../../operations/common/resourceLocatorFactory');
const { ResourceMerger } = require('../../../../operations/common/resourceMerger');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { MongoDatabaseManager } = require('../../../../utils/mongoDatabaseManager');

function createMockInstance (ClassType) {
    const instance = Object.create(ClassType.prototype);
    return instance;
}

describe('FixReferenceSourceAssigningAuthorityRunner', () => {
    let runner;
    let mockAdminLogger;
    let mockMongoDatabaseManager;
    let mockPreSaveManager;
    let mockDatabaseQueryFactory;
    let mockResourceLocatorFactory;
    let mockResourceMerger;

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
        mockMongoDatabaseManager.createClientAsync = jestGlobal.fn();

        mockPreSaveManager = createMockInstance(PreSaveManager);
        mockPreSaveManager.preSaveAsync = jestGlobal.fn().mockImplementation(({ resource }) => resource);

        mockDatabaseQueryFactory = createMockInstance(DatabaseQueryFactory);
        mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
            findOneAsync: jestGlobal.fn().mockResolvedValue(null)
        });

        mockResourceLocatorFactory = createMockInstance(ResourceLocatorFactory);
        mockResourceLocatorFactory.createResourceLocator = jestGlobal.fn().mockReturnValue({
            getCollectionName: () => 'Patient_4_0_0'
        });

        mockResourceMerger = createMockInstance(ResourceMerger);
        mockResourceMerger.mergeResourceAsync = jestGlobal.fn().mockResolvedValue({ patches: [] });

        runner = new FixReferenceSourceAssigningAuthorityRunner({
            collections: ['Patient_4_0_0'],
            batchSize: 100,
            adminLogger: mockAdminLogger,
            mongoDatabaseManager: mockMongoDatabaseManager,
            preSaveManager: mockPreSaveManager,
            afterLastUpdatedDate: undefined,
            databaseQueryFactory: mockDatabaseQueryFactory,
            startFromCollection: undefined,
            resourceLocatorFactory: mockResourceLocatorFactory,
            preloadCollections: [],
            limit: undefined,
            properties: undefined,
            resourceMerger: mockResourceMerger,
            useTransaction: undefined,
            skip: undefined,
            filterToRecordsWithFields: undefined,
            startFromId: undefined
        });
    });

    describe('getCacheForResourceType', () => {
        test('creates a new map for unknown collection', () => {
            const cache = runner.getCacheForResourceType({ collectionName: 'Patient_4_0_0' });
            expect(cache).toBeInstanceOf(Map);
            expect(cache.size).toBe(0);
        });

        test('returns same map for same collection name', () => {
            const cache1 = runner.getCacheForResourceType({ collectionName: 'Patient_4_0_0' });
            cache1.set('uuid-1', { _uuid: 'uuid-1', _sourceId: 'src-1', _sourceAssigningAuthority: 'saa-1' });
            const cache2 = runner.getCacheForResourceType({ collectionName: 'Patient_4_0_0' });
            expect(cache2.size).toBe(1);
            expect(cache2).toBe(cache1);
        });

        test('returns different maps for different collection names', () => {
            const cache1 = runner.getCacheForResourceType({ collectionName: 'Patient_4_0_0' });
            const cache2 = runner.getCacheForResourceType({ collectionName: 'Observation_4_0_0' });
            expect(cache1).not.toBe(cache2);
        });
    });

    describe('updateReferenceAsync', () => {
        test('returns reference unchanged when reference.reference is empty', async () => {
            const ref = { reference: '' };
            const result = await runner.updateReferenceAsync(ref, mockDatabaseQueryFactory);
            expect(result.reference).toBe('');
        });

        test('returns reference unchanged when resourceType is not parseable', async () => {
            const ref = { reference: 'no-slash' };
            const result = await runner.updateReferenceAsync(ref, mockDatabaseQueryFactory);
            expect(result.reference).toBe('no-slash');
        });

        test('increments cacheHits when uuid is found in cache', async () => {
            const cache = runner.getCacheForResourceType({ collectionName: 'Patient_4_0_0' });
            cache.set('existing-uuid', { _uuid: 'existing-uuid', _sourceId: 'src-1', _sourceAssigningAuthority: 'saa-1' });

            const ref = {
                reference: 'Patient/src-1',
                _uuid: 'Patient/existing-uuid'
            };

            await runner.updateReferenceAsync(ref, mockDatabaseQueryFactory);
            expect(runner.cacheHits.get('Patient_4_0_0')).toBe(1);
        });

        test('finds matching _sourceId in cache and updates reference', async () => {
            const cache = runner.getCacheForResourceType({ collectionName: 'Patient_4_0_0' });
            cache.set('uuid-123', { _uuid: 'uuid-123', _sourceId: 'patient-src', _sourceAssigningAuthority: 'mySAA' });

            const ref = {
                reference: 'Patient/patient-src',
                _uuid: undefined
            };

            await runner.updateReferenceAsync(ref, mockDatabaseQueryFactory);
            expect(ref._sourceAssigningAuthority).toBe('mySAA');
            expect(ref._uuid).toBe('Patient/uuid-123');
        });

        test('increments cacheMisses when uuid not found in cache and DB returns null', async () => {
            const ref = {
                reference: 'Patient/not-found',
                _uuid: 'Patient/not-found-uuid'
            };

            await runner.updateReferenceAsync(ref, mockDatabaseQueryFactory);
            expect(runner.cacheMisses.get('Patient_4_0_0')).toBe(1);
        });

        test('adds resource to resourcesNotFound when DB finds nothing', async () => {
            const ref = {
                reference: 'Patient/not-found',
                _uuid: 'Patient/not-found-uuid'
            };

            await runner.updateReferenceAsync(ref, mockDatabaseQueryFactory);
            expect(runner.resourcesNotFound.get('Patient_4_0_0')).toContain('not-found');
        });

        test('updates reference extensions when sourceId is found in cache', async () => {
            const cache = runner.getCacheForResourceType({ collectionName: 'Patient_4_0_0' });
            cache.set('uuid-123', { _uuid: 'uuid-123', _sourceId: 'patient-src', _sourceAssigningAuthority: 'mySAA' });

            const ref = {
                reference: 'Patient/patient-src',
                _uuid: undefined,
                extension: [
                    { id: 'uuid', url: 'uuid', valueString: '' },
                    { id: 'sourceAssigningAuthority', url: 'sourceAssigningAuthority', valueString: '' }
                ]
            };

            await runner.updateReferenceAsync(ref, mockDatabaseQueryFactory);
            expect(ref.extension[0].valueString).toBe('Patient/uuid-123');
            expect(ref.extension[1].valueString).toBe('mySAA');
        });
    });

    describe('processRecordAsync', () => {
        test('returns empty operations when resource is unchanged', async () => {
            const doc = {
                _id: 'test-id',
                resourceType: 'Patient',
                id: 'patient-1',
                _uuid: 'uuid-1',
                _sourceId: 'patient-1',
                meta: { lastUpdated: new Date() }
            };

            // No references to update, preSave returns same resource
            const operations = await runner.processRecordAsync({
                base_version: '4_0_0',
                requestInfo: {},
                doc
            });
            expect(operations).toEqual([]);
        });
    });

    // CACHE ANALYSIS
    // Cache mechanism: this.caches (Map<collectionName, Map<uuid, {_uuid, _sourceId, _sourceAssigningAuthority}>>)
    // Cache KEY: collectionName + uuid
    // Cache VALUE: {_uuid, _sourceId, _sourceAssigningAuthority}
    // Params NOT in cache key: the reference itself (reference.reference, reference._uuid)
    // Downstream: updateReferenceAsync uses cache to set reference._sourceAssigningAuthority
    describe('cache behavior', () => {
        test('second call with same cache key but different reference uses cached SAA', async () => {
            const cache = runner.getCacheForResourceType({ collectionName: 'Patient_4_0_0' });
            cache.set('uuid-A', { _uuid: 'uuid-A', _sourceId: 'src-A', _sourceAssigningAuthority: 'saa-from-cache' });

            const ref1 = {
                reference: 'Patient/src-A',
                _uuid: undefined,
                _sourceAssigningAuthority: 'old-saa-1'
            };
            const ref2 = {
                reference: 'Patient/src-A',
                _uuid: undefined,
                _sourceAssigningAuthority: 'old-saa-2'
            };

            await runner.updateReferenceAsync(ref1, mockDatabaseQueryFactory);
            await runner.updateReferenceAsync(ref2, mockDatabaseQueryFactory);

            expect(ref1._sourceAssigningAuthority).toBe('saa-from-cache');
            expect(ref2._sourceAssigningAuthority).toBe('saa-from-cache');
            expect(runner.cacheHits.get('Patient_4_0_0')).toBe(2);
        });
    });
});
