const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

// Mock dependencies
const { FixReferenceIdRunner } = require('../../../../admin/runners/fixReferenceIdRunner');
const { PreSaveManager } = require('../../../../preSaveHandlers/preSave');
const { DatabaseQueryFactory } = require('../../../../dataLayer/databaseQueryFactory');
const { ResourceLocatorFactory } = require('../../../../operations/common/resourceLocatorFactory');
const { ResourceMerger } = require('../../../../operations/common/resourceMerger');
const { SearchParametersManager } = require('../../../../searchParameters/searchParametersManager');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { MongoDatabaseManager } = require('../../../../utils/mongoDatabaseManager');
const { IdentifierSystem } = require('../../../../utils/identifierSystem');

// Create mock instances that pass assertTypeEquals checks
function createMockInstance (ClassType) {
    const instance = Object.create(ClassType.prototype);
    return instance;
}

describe('FixReferenceIdRunner', () => {
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
        mockPreSaveManager.preSaveAsync = jestGlobal.fn().mockImplementation(({ resource }) => resource);

        mockDatabaseQueryFactory = createMockInstance(DatabaseQueryFactory);
        mockDatabaseQueryFactory.createQuery = jestGlobal.fn();

        mockResourceLocatorFactory = createMockInstance(ResourceLocatorFactory);
        mockResourceLocatorFactory.createResourceLocator = jestGlobal.fn().mockReturnValue({
            getCollectionName: () => 'Patient_4_0_0'
        });

        mockResourceMerger = createMockInstance(ResourceMerger);
        mockSearchParametersManager = createMockInstance(SearchParametersManager);
        mockSearchParametersManager.getSearchParametersForResource = jestGlobal.fn().mockReturnValue({});

        runner = new FixReferenceIdRunner({
            collections: ['Patient_4_0_0'],
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
            proaCollections: ['Patient_4_0_0'],
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

    // ---- getFilter (top 3 largest: processAsync, updateReferenceAsync, processRecordAsync) ----

    describe('getFilter', () => {
        test('returns empty object for empty properties array', () => {
            const result = runner.getFilter([]);
            expect(result).toEqual({});
        });

        test('returns empty object for undefined properties', () => {
            const result = runner.getFilter(undefined);
            expect(result).toEqual({});
        });

        test('returns single property filter for array with one item', () => {
            const result = runner.getFilter(['subject']);
            expect(result).toEqual({ subject: { $exists: true } });
        });

        test('returns $and filter for multiple properties', () => {
            const result = runner.getFilter(['subject', 'performer']);
            expect(result).toEqual({
                $and: [
                    { subject: { $exists: true } },
                    { performer: { $exists: true } }
                ]
            });
        });
    });

    describe('getProjection', () => {
        test('includes specified properties plus needed properties', () => {
            runner.properties = ['subject', 'encounter'];
            const result = runner.getProjection();
            expect(result.subject).toBe(1);
            expect(result.encounter).toBe(1);
            expect(result.resourceType).toBe(1);
            expect(result.meta).toBe(1);
            expect(result._uuid).toBe(1);
            expect(result._sourceId).toBe(1);
            expect(result._sourceAssigningAuthority).toBe(1);
        });
    });

    describe('getOriginalId', () => {
        test('extracts id from meta.source', () => {
            const doc = { meta: { source: 'http://example.com/Patient/abc-123' } };
            const result = runner.getOriginalId({ doc, _sanitize: false });
            expect(result).toBe('abc-123');
        });

        test('sanitizes special characters when _sanitize is true', () => {
            const doc = { meta: { source: 'http://example.com/Patient/abc@#$123' } };
            const result = runner.getOriginalId({ doc, _sanitize: true });
            expect(result).toBe('abc---123');
        });

        test('does not sanitize when _sanitize is false', () => {
            const doc = { meta: { source: 'http://example.com/Patient/abc@#$123' } };
            const result = runner.getOriginalId({ doc, _sanitize: false });
            expect(result).toBe('abc@#$123');
        });

        test('returns empty string when meta.source is undefined', () => {
            const doc = { meta: {} };
            const result = runner.getOriginalId({ doc, _sanitize: false });
            expect(result).toBe('');
        });

        test('returns empty string when meta is undefined', () => {
            const doc = {};
            const result = runner.getOriginalId({ doc, _sanitize: false });
            expect(result).toBe('');
        });
    });

    describe('getCurrentIds', () => {
        test('creates sanitized and unsanitized ids with sourceAssigningAuthority', () => {
            const result = runner.getCurrentIds({
                originalId: 'patient123',
                _sourceAssigningAuthority: 'mySource'
            });
            expect(result).toHaveLength(2);
            expect(result[0]).toBe('mySource-patient123');
            expect(result[1]).toBe('mySource-patient123');
        });

        test('creates ids without sourceAssigningAuthority prefix', () => {
            const result = runner.getCurrentIds({
                originalId: 'patient123',
                _sourceAssigningAuthority: ''
            });
            expect(result).toHaveLength(2);
            expect(result[0]).toBe('patient123');
            expect(result[1]).toBe('patient123');
        });

        test('sanitizes special characters in sourceAssigningAuthority', () => {
            const result = runner.getCurrentIds({
                originalId: 'patient123',
                _sourceAssigningAuthority: 'my@source'
            });
            expect(result[0]).toBe('my-source-patient123');
            expect(result[1]).toBe('my@source-patient123');
        });

        test('truncates to 63 characters', () => {
            const longId = 'a'.repeat(60);
            const result = runner.getCurrentIds({
                originalId: longId,
                _sourceAssigningAuthority: 'src'
            });
            expect(result[0].length).toBeLessThanOrEqual(63);
            expect(result[1].length).toBeLessThanOrEqual(63);
        });
    });

    describe('getCacheForReference', () => {
        test('creates a new map for unknown collection', () => {
            const cache = runner.getCacheForReference({ collectionName: 'Patient_4_0_0' });
            expect(cache).toBeInstanceOf(Map);
            expect(cache.size).toBe(0);
        });

        test('returns same map for same base collection name', () => {
            const cache1 = runner.getCacheForReference({ collectionName: 'Patient_4_0_0' });
            cache1.set('key1', 'value1');
            const cache2 = runner.getCacheForReference({ collectionName: 'Patient_4_0_0_History' });
            // Both should reference same base 'Patient' cache
            expect(cache2).toBe(cache1);
        });

        test('returns different maps for different resource types', () => {
            const cache1 = runner.getCacheForReference({ collectionName: 'Patient_4_0_0' });
            const cache2 = runner.getCacheForReference({ collectionName: 'Observation_4_0_0' });
            expect(cache2).not.toBe(cache1);
        });
    });

    describe('cacheReferenceFromResource', () => {
        test('caches reference when currentId matches _sourceId', () => {
            const doc = {
                _sourceId: 'mySource-abc123',
                _sourceAssigningAuthority: 'mySource',
                _uuid: 'existing-uuid',
                meta: {
                    source: 'http://example.com/Patient/abc123'
                }
            };

            runner.cacheReferenceFromResource({ doc, collectionName: 'Patient_4_0_0' });

            const cache = runner.getCacheForReference({ collectionName: 'Patient' });
            expect(cache.has('Patient/mySource-abc123')).toBe(true);
            expect(cache.get('Patient/mySource-abc123')).toBe('Patient/abc123');
        });

        test('does not cache when currentId does not match _sourceId', () => {
            const doc = {
                _sourceId: 'unrelated-id',
                _sourceAssigningAuthority: 'mySource',
                _uuid: 'existing-uuid',
                meta: {
                    source: 'http://example.com/Patient/abc123'
                }
            };

            runner.cacheReferenceFromResource({ doc, collectionName: 'Patient_4_0_0' });

            const cache = runner.getCacheForReference({ collectionName: 'Patient' });
            expect(cache.size).toBe(0);
        });

        test('uses security tag for sourceAssigningAuthority when _sourceAssigningAuthority is empty', () => {
            const doc = {
                _sourceId: 'mySecuritySource-abc123',
                _sourceAssigningAuthority: undefined,
                _uuid: 'existing-uuid',
                meta: {
                    source: 'http://example.com/Patient/abc123',
                    security: [
                        {
                            system: 'https://www.icanbwell.com/sourceAssigningAuthority',
                            code: 'mySecuritySource'
                        }
                    ]
                }
            };

            runner.cacheReferenceFromResource({ doc, collectionName: 'Patient_4_0_0' });

            const cache = runner.getCacheForReference({ collectionName: 'Patient' });
            expect(cache.has('Patient/mySecuritySource-abc123')).toBe(true);
        });
    });

    describe('updateReferenceAsync', () => {
        test('returns reference unchanged when reference is null', async () => {
            const result = await runner.updateReferenceAsync(null, mockDatabaseQueryFactory);
            expect(result).toBeNull();
        });

        test('returns reference unchanged when reference.reference is empty', async () => {
            const ref = { reference: '' };
            const result = await runner.updateReferenceAsync(ref, mockDatabaseQueryFactory);
            expect(result).toEqual(ref);
        });

        test('updates reference when found in cache', async () => {
            // Pre-populate cache
            const cache = runner.getCacheForReference({ collectionName: 'Patient' });
            cache.set('Patient/old-id', 'Patient/new-id');
            runner.uuidCache.set('old-id', 'new-uuid');

            const ref = {
                reference: 'Patient/old-id',
                _sourceId: 'Patient/old-id',
                _uuid: 'Patient/old-uuid'
            };

            const result = await runner.updateReferenceAsync(ref, mockDatabaseQueryFactory);
            expect(result.reference).toBe('Patient/new-id');
            expect(result._sourceId).toBe('Patient/new-id');
            expect(result._uuid).toBe('Patient/new-uuid');
        });

        test('increments cacheHits when reference found in cache', async () => {
            const cache = runner.getCacheForReference({ collectionName: 'Patient' });
            cache.set('Patient/old-id', 'Patient/new-id');
            runner.uuidCache.set('old-id', 'new-uuid');

            const ref = {
                reference: 'Patient/old-id',
                _sourceId: 'Patient/old-id',
                _uuid: 'Patient/old-uuid'
            };

            await runner.updateReferenceAsync(ref, mockDatabaseQueryFactory);
            expect(runner.cacheHits.get('Patient')).toBe(1);
        });

        test('increments cacheMisses when reference not found in cache', async () => {
            const ref = {
                reference: 'Patient/not-in-cache',
                _sourceId: 'Patient/not-in-cache',
                _uuid: 'Patient/some-uuid'
            };

            await runner.updateReferenceAsync(ref, mockDatabaseQueryFactory);
            expect(runner.cacheMisses.get('Patient')).toBe(1);
        });

        test('updates reference extension when reference found in cache', async () => {
            const cache = runner.getCacheForReference({ collectionName: 'Patient' });
            cache.set('Patient/old-id', 'Patient/new-id');
            runner.uuidCache.set('old-id', 'new-uuid');

            const ref = {
                reference: 'Patient/old-id',
                _sourceId: 'Patient/old-id',
                _uuid: 'Patient/old-uuid',
                extension: [
                    { url: IdentifierSystem.sourceId, valueString: 'Patient/old-id' },
                    { url: IdentifierSystem.uuid, valueString: 'Patient/old-uuid' }
                ]
            };

            await runner.updateReferenceAsync(ref, mockDatabaseQueryFactory);
            expect(ref.extension[0].valueString).toBe('Patient/new-id');
            expect(ref.extension[1].valueString).toBe('Patient/new-uuid');
        });

        test('returns reference unchanged when resourceType cannot be parsed', async () => {
            const ref = {
                reference: 'invalid-no-slash',
                _sourceId: 'invalid-no-slash'
            };

            const result = await runner.updateReferenceAsync(ref, mockDatabaseQueryFactory);
            expect(result.reference).toBe('invalid-no-slash');
        });
    });

    describe('getQueryFromParameters', () => {
        test('returns empty filter when no parameters are set', () => {
            const result = runner.getQueryFromParameters({ queryPrefix: '' });
            expect(result).toEqual({});
        });

        test('returns afterLastUpdatedDate query', () => {
            runner.afterLastUpdatedDate = new Date('2023-01-01');
            const result = runner.getQueryFromParameters({ queryPrefix: '' });
            expect(result['meta.lastUpdated'].$gt).toEqual(new Date('2023-01-01'));
        });

        test('returns beforeLastUpdatedDate query', () => {
            runner.beforeLastUpdatedDate = new Date('2023-12-31');
            const result = runner.getQueryFromParameters({ queryPrefix: '' });
            expect(result['meta.lastUpdated'].$lt).toEqual(new Date('2023-12-31'));
        });

        test('returns $and query when both dates are set', () => {
            runner.afterLastUpdatedDate = new Date('2023-01-01');
            runner.beforeLastUpdatedDate = new Date('2023-12-31');
            const result = runner.getQueryFromParameters({ queryPrefix: '' });
            expect(result.$and).toHaveLength(2);
        });

        test('uses queryPrefix for history collections', () => {
            runner.afterLastUpdatedDate = new Date('2023-01-01');
            const result = runner.getQueryFromParameters({ queryPrefix: 'resource.' });
            expect(result['resource.meta.lastUpdated'].$gt).toEqual(new Date('2023-01-01'));
        });

        test('includes startFromId in query when set', () => {
            runner.startFromId = 'some-start-id';
            const result = runner.getQueryFromParameters({ queryPrefix: '' });
            expect(result._id.$gte).toBe('some-start-id');
        });
    });

    describe('getQueryForResource', () => {
        test('creates query with proa security filter for non-history collection', () => {
            const result = runner.getQueryForResource(false);
            expect(result.$and).toBeDefined();
            expect(result.$and.some(q =>
                q['meta.security.system'] === 'https://www.icanbwell.com/connectionType' &&
                q['meta.security.code'] === 'proa'
            )).toBe(true);
        });

        test('creates query with resource prefix for history collection', () => {
            const result = runner.getQueryForResource(true);
            expect(result.$and).toBeDefined();
            expect(result.$and.some(q =>
                q['resource.meta.security.system'] === 'https://www.icanbwell.com/connectionType' &&
                q['resource.meta.security.code'] === 'proa'
            )).toBe(true);
        });
    });

    describe('collectionExistsInDb', () => {
        test('throws error when collectionsInDb is not initialized', () => {
            expect(() => runner.collectionExistsInDb({ collectionName: 'Patient_4_0_0' }))
                .toThrow('Please Run createSingleCollections before using this function');
        });

        test('returns true when collection exists', () => {
            runner.collectionsInDb = ['Patient_4_0_0', 'Observation_4_0_0'];
            expect(runner.collectionExistsInDb({ collectionName: 'Patient_4_0_0' })).toBe(true);
        });

        test('returns false when collection does not exist', () => {
            runner.collectionsInDb = ['Patient_4_0_0'];
            expect(runner.collectionExistsInDb({ collectionName: 'Missing_4_0_0' })).toBe(false);
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

            // updateRecord that does nothing
            const updateRecord = async function (resource) { return resource; };

            const operations = await runner.processRecordAsync(doc, updateRecord);
            expect(operations).toEqual([]);
        });

        test('returns updateOne operation when resource is changed', async () => {
            const doc = {
                _id: 'test-id',
                resourceType: 'Patient',
                id: 'patient-1',
                _uuid: 'uuid-1',
                _sourceId: 'patient-1',
                _sourceAssigningAuthority: 'src',
                meta: { lastUpdated: new Date() }
            };

            const updateRecord = async function (resource) {
                resource.id = 'new-patient-id';
                return resource;
            };

            const operations = await runner.processRecordAsync(doc, updateRecord);
            expect(operations.length).toBeGreaterThan(0);
            expect(operations[0].updateOne).toBeDefined();
            expect(operations[0].updateOne.filter._id).toBe('test-id');
        });

        test('handles history documents with request field', async () => {
            const doc = {
                _id: 'test-id',
                resource: {
                    resourceType: 'Patient',
                    id: 'patient-1',
                    _uuid: 'uuid-1',
                    _sourceId: 'patient-1',
                    _sourceAssigningAuthority: 'src',
                    meta: { lastUpdated: new Date() }
                },
                request: {
                    url: 'Patient/patient-1'
                }
            };

            const updateRecord = async function (resource) {
                resource.id = 'new-patient-id';
                return resource;
            };

            const operations = await runner.processRecordAsync(doc, updateRecord);
            expect(operations.length).toBeGreaterThan(0);
        });
    });

    // ---- CACHE ANALYSIS ----
    // Cache mechanism: this.caches (Map<string, Map<string, string>>), this.uuidCache (Map)
    // Cache KEY: collectionName (base name, e.g., 'Patient')
    // Within each collection cache, KEY is currentReference (e.g., 'Patient/old-id')
    // The caches are instance-level Maps, not request-specific. They persist across calls.
    describe('cache behavior', () => {
        test('second updateReferenceAsync call with same cache uses cached values', async () => {
            const cache = runner.getCacheForReference({ collectionName: 'Patient' });
            cache.set('Patient/id1', 'Patient/newid1');
            runner.uuidCache.set('id1', 'new-uuid-1');

            const ref1 = {
                reference: 'Patient/id1',
                _sourceId: 'Patient/id1',
                _uuid: 'Patient/old-uuid-1'
            };

            const ref2 = {
                reference: 'Patient/id1',
                _sourceId: 'Patient/id1',
                _uuid: 'Patient/old-uuid-2'
            };

            await runner.updateReferenceAsync(ref1, mockDatabaseQueryFactory);
            await runner.updateReferenceAsync(ref2, mockDatabaseQueryFactory);

            expect(ref1.reference).toBe('Patient/newid1');
            expect(ref2.reference).toBe('Patient/newid1');
            expect(runner.cacheHits.get('Patient')).toBe(2);
        });
    });
});
