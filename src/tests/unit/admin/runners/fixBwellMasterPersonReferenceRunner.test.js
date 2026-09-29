const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

const { FixBwellMasterPersonReferenceRunner } = require('../../../../admin/runners/fixBwellMasterPersonReferenceRunner');
const { PreSaveManager } = require('../../../../preSaveHandlers/preSave');
const { DatabaseQueryFactory } = require('../../../../dataLayer/databaseQueryFactory');
const { ResourceLocatorFactory } = require('../../../../operations/common/resourceLocatorFactory');
const { ResourceMerger } = require('../../../../operations/common/resourceMerger');
const { SearchParametersManager } = require('../../../../searchParameters/searchParametersManager');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { MongoDatabaseManager } = require('../../../../utils/mongoDatabaseManager');
const { IdentifierSystem } = require('../../../../utils/identifierSystem');
const { SecurityTagSystem } = require('../../../../utils/securityTagSystem');

function createMockInstance (ClassType) {
    const instance = Object.create(ClassType.prototype);
    return instance;
}

describe('FixBwellMasterPersonReferenceRunner', () => {
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
        mockMongoDatabaseManager.createClientAsync = jestGlobal.fn();

        mockPreSaveManager = createMockInstance(PreSaveManager);
        mockPreSaveManager.preSaveAsync = jestGlobal.fn().mockImplementation(({ resource }) => resource);

        mockDatabaseQueryFactory = createMockInstance(DatabaseQueryFactory);
        mockDatabaseQueryFactory.createQuery = jestGlobal.fn();

        mockResourceLocatorFactory = createMockInstance(ResourceLocatorFactory);
        mockResourceLocatorFactory.createResourceLocator = jestGlobal.fn().mockReturnValue({
            getCollectionName: () => 'Person_4_0_0'
        });

        mockResourceMerger = createMockInstance(ResourceMerger);
        mockSearchParametersManager = createMockInstance(SearchParametersManager);
        mockSearchParametersManager.getSearchParametersForResource = jestGlobal.fn().mockReturnValue({});

        runner = new FixBwellMasterPersonReferenceRunner({
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
            proaCollections: [],
            limit: undefined,
            properties: undefined,
            resourceMerger: mockResourceMerger,
            useTransaction: undefined,
            skip: undefined,
            filterToRecordsWithFields: undefined,
            startFromId: undefined,
            searchParametersManager: mockSearchParametersManager,
            preLoadCollections: ['Person_4_0_0', 'Patient_4_0_0'],
            logUnresolvedReferencesToFile: false
        });
    });

    describe('cacheReferenceFromResource', () => {
        test('caches idReference to {uuidReference, sourceAssigningAuthority}', () => {
            const doc = {
                _sourceId: 'person-src-1',
                _uuid: 'uuid-person-1',
                _sourceAssigningAuthority: 'clientSAA',
                meta: { security: [] }
            };

            runner.cacheReferenceFromResource({ doc, collectionName: 'Person_4_0_0' });

            expect(runner.caches.has('Person/person-src-1')).toBe(true);
            const entries = Array.from(runner.caches.get('Person/person-src-1'));
            expect(entries.length).toBe(1);
            const parsed = JSON.parse(entries[0]);
            expect(parsed.uuidReference).toBe('Person/uuid-person-1');
            expect(parsed.sourceAssigningAuthority).toBe('clientSAA');
        });

        test('does not cache when _sourceId is undefined', () => {
            const doc = {
                _sourceId: undefined,
                _uuid: 'uuid-person-1',
                _sourceAssigningAuthority: 'clientSAA'
            };

            runner.cacheReferenceFromResource({ doc, collectionName: 'Person_4_0_0' });
            expect(runner.caches.size).toBe(0);
        });

        test('does not cache when _uuid is undefined', () => {
            const doc = {
                _sourceId: 'person-src-1',
                _uuid: undefined,
                _sourceAssigningAuthority: 'clientSAA'
            };

            runner.cacheReferenceFromResource({ doc, collectionName: 'Person_4_0_0' });
            expect(runner.caches.size).toBe(0);
        });

        test('does not cache when sourceAssigningAuthority is empty', () => {
            const doc = {
                _sourceId: 'person-src-1',
                _uuid: 'uuid-person-1',
                _sourceAssigningAuthority: '',
                meta: { security: [] }
            };

            runner.cacheReferenceFromResource({ doc, collectionName: 'Person_4_0_0' });
            expect(runner.caches.size).toBe(0);
        });

        test('gets sourceAssigningAuthority from security tag when not in field', () => {
            const doc = {
                _sourceId: 'person-src-1',
                _uuid: 'uuid-person-1',
                _sourceAssigningAuthority: undefined,
                meta: {
                    security: [
                        { system: SecurityTagSystem.sourceAssigningAuthority, code: 'fromSecurityTag' }
                    ]
                }
            };

            runner.cacheReferenceFromResource({ doc, collectionName: 'Person_4_0_0' });

            expect(runner.caches.has('Person/person-src-1')).toBe(true);
            const entries = Array.from(runner.caches.get('Person/person-src-1'));
            const parsed = JSON.parse(entries[0]);
            expect(parsed.sourceAssigningAuthority).toBe('fromSecurityTag');
        });

        test('adds multiple entries for same idReference (different resources)', () => {
            const doc1 = {
                _sourceId: 'shared-src',
                _uuid: 'uuid-1',
                _sourceAssigningAuthority: 'saaA',
                meta: { security: [] }
            };
            const doc2 = {
                _sourceId: 'shared-src',
                _uuid: 'uuid-2',
                _sourceAssigningAuthority: 'saaB',
                meta: { security: [] }
            };

            runner.cacheReferenceFromResource({ doc: doc1, collectionName: 'Person_4_0_0' });
            runner.cacheReferenceFromResource({ doc: doc2, collectionName: 'Person_4_0_0' });

            const entries = Array.from(runner.caches.get('Person/shared-src'));
            expect(entries.length).toBe(2);
        });
    });

    describe('updateResourceReferenceAsync', () => {
        test('returns resource unchanged when no link', async () => {
            const resource = { resourceType: 'Person', _uuid: 'uuid-1' };
            const result = await runner.updateResourceReferenceAsync(resource, false);
            expect(result).toEqual(resource);
        });

        test('returns resource unchanged when link is empty', async () => {
            const resource = { resourceType: 'Person', _uuid: 'uuid-1', link: [] };
            const result = await runner.updateResourceReferenceAsync(resource, false);
            expect(result.link).toEqual([]);
        });

        test('resolves reference when exactly one match in cache', async () => {
            runner.caches.set('Person/old-src', new Set([
                JSON.stringify({ uuidReference: 'Person/new-uuid', sourceAssigningAuthority: 'newSAA' })
            ]));

            const resource = {
                resourceType: 'Person',
                _uuid: 'uuid-1',
                link: [{
                    target: {
                        reference: 'Person/old-src',
                        _sourceId: 'Person/old-src',
                        _uuid: undefined,
                        extension: [
                            { url: IdentifierSystem.sourceId, valueString: 'Person/old-src' },
                            { url: IdentifierSystem.uuid, valueString: '' },
                            { url: SecurityTagSystem.sourceAssigningAuthority, valueString: '' }
                        ]
                    }
                }]
            };

            const result = await runner.updateResourceReferenceAsync(resource, false);
            expect(result.link[0].target.reference).toBe('Person/new-uuid');
            expect(result.link[0].target._sourceAssigningAuthority).toBe('newSAA');
        });

        test('does not resolve reference when multiple matches in cache (unresolved)', async () => {
            runner.caches.set('Person/ambiguous', new Set([
                JSON.stringify({ uuidReference: 'Person/uuid-A', sourceAssigningAuthority: 'saaA' }),
                JSON.stringify({ uuidReference: 'Person/uuid-B', sourceAssigningAuthority: 'saaB' })
            ]));

            const resource = {
                resourceType: 'Person',
                _uuid: 'uuid-1',
                link: [{
                    target: {
                        reference: 'Person/ambiguous',
                        _sourceId: 'Person/ambiguous',
                        _uuid: 'Person/ambiguous-uuid'
                    }
                }]
            };

            const result = await runner.updateResourceReferenceAsync(resource, false);
            // Reference should remain unchanged
            expect(result.link[0].target.reference).toBe('Person/ambiguous');
        });

        test('handles reference with pipe (sourceAssigningAuthority in reference)', async () => {
            const resource = {
                resourceType: 'Person',
                _uuid: 'uuid-1',
                link: [{
                    target: {
                        reference: 'Patient/pat-id|saa',
                        _uuid: 'Patient/pat-uuid',
                        _sourceId: 'Patient/pat-src',
                        extension: [
                            { url: IdentifierSystem.sourceId, valueString: 'Patient/pat-src' },
                            { url: IdentifierSystem.uuid, valueString: 'Patient/pat-uuid' },
                            { url: SecurityTagSystem.sourceAssigningAuthority, valueString: '' }
                        ]
                    }
                }]
            };

            const result = await runner.updateResourceReferenceAsync(resource, false);
            // When pipe is present, reference should be updated to uuid
            expect(result.link[0].target.reference).toBe('Patient/pat-uuid');
        });

        test('removes duplicate links based on uuid', async () => {
            const resource = {
                resourceType: 'Person',
                _uuid: 'uuid-1',
                link: [
                    {
                        target: {
                            reference: 'Patient/pat-id|saa',
                            _uuid: 'Patient/same-uuid',
                            extension: [{ url: IdentifierSystem.uuid, valueString: 'Patient/same-uuid' }]
                        }
                    },
                    {
                        target: {
                            reference: 'Patient/pat-id2|saa',
                            _uuid: 'Patient/same-uuid',
                            extension: [{ url: IdentifierSystem.uuid, valueString: 'Patient/same-uuid' }]
                        }
                    }
                ]
            };

            const result = await runner.updateResourceReferenceAsync(resource, false);
            expect(result.link.length).toBe(1);
        });
    });

    describe('getQueryForResource', () => {
        test('creates query with bwell owner filter for non-history collection', () => {
            const result = runner.getQueryForResource(false);
            expect(result.$and).toBeDefined();
            const hasOwnerFilter = result.$and.some(q =>
                q['meta.security'] && q['meta.security'].$elemMatch &&
                q['meta.security'].$elemMatch.system === SecurityTagSystem.owner &&
                q['meta.security'].$elemMatch.code === 'bwell'
            );
            expect(hasOwnerFilter).toBe(true);
        });

        test('creates query with resource prefix for history collection', () => {
            const result = runner.getQueryForResource(true);
            expect(result.$and).toBeDefined();
            const hasOwnerFilter = result.$and.some(q =>
                q['resource.meta.security'] && q['resource.meta.security'].$elemMatch &&
                q['resource.meta.security'].$elemMatch.system === SecurityTagSystem.owner &&
                q['resource.meta.security'].$elemMatch.code === 'bwell'
            );
            expect(hasOwnerFilter).toBe(true);
        });
    });

    describe('processRecordAsync', () => {
        test('returns empty operations when resource is unchanged', async () => {
            const doc = {
                _id: 'test-id',
                resourceType: 'Person',
                id: 'person-1',
                _uuid: 'uuid-1',
                _sourceId: 'person-1',
                meta: { lastUpdated: new Date() }
            };

            const operations = await runner.processRecordAsync(doc);
            expect(operations).toEqual([]);
        });

        test('returns replaceOne operation for history documents', async () => {
            runner.caches.set('Patient/old-src', new Set([
                JSON.stringify({ uuidReference: 'Patient/new-uuid', sourceAssigningAuthority: 'newSAA' })
            ]));

            const doc = {
                _id: 'test-id',
                resource: {
                    resourceType: 'Person',
                    id: 'person-1',
                    _uuid: 'uuid-1',
                    _sourceId: 'person-1',
                    meta: { lastUpdated: new Date() },
                    link: [{
                        target: {
                            reference: 'Patient/old-src',
                            _sourceId: 'Patient/old-src',
                            _uuid: undefined
                        }
                    }]
                }
            };

            const operations = await runner.processRecordAsync(doc);
            expect(operations.length).toBeGreaterThan(0);
            expect(operations[0].replaceOne).toBeDefined();
        });
    });

    // CACHE ANALYSIS
    // Cache mechanism: this.caches (Map<idReference, Set<JSON{uuidReference, sourceAssigningAuthority}>>)
    // Cache KEY: idReference (e.g., 'Person/old-src')
    // Cache VALUE: Set of JSON strings with {uuidReference, sourceAssigningAuthority}
    // Downstream: updateResourceReferenceAsync reads from this.caches
    describe('cache behavior', () => {
        test('second call with same cache key resolves both from cache', async () => {
            runner.caches.set('Person/shared-id', new Set([
                JSON.stringify({ uuidReference: 'Person/resolved-uuid', sourceAssigningAuthority: 'resolvedSAA' })
            ]));

            const resource1 = {
                resourceType: 'Person',
                _uuid: 'uuid-1',
                link: [{
                    target: {
                        reference: 'Person/shared-id',
                        _sourceId: 'Person/shared-id',
                        _uuid: undefined
                    }
                }]
            };

            const resource2 = {
                resourceType: 'Person',
                _uuid: 'uuid-2',
                link: [{
                    target: {
                        reference: 'Person/shared-id',
                        _sourceId: 'Person/shared-id',
                        _uuid: undefined
                    }
                }]
            };

            const result1 = await runner.updateResourceReferenceAsync(resource1, false);
            const result2 = await runner.updateResourceReferenceAsync(resource2, false);

            expect(result1.link[0].target.reference).toBe('Person/resolved-uuid');
            expect(result2.link[0].target.reference).toBe('Person/resolved-uuid');
        });
    });
});
