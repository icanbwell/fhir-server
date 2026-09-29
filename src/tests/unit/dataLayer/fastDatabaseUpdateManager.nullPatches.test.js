'use strict';

const { describe, test, beforeEach, expect, jest: jestGlobal } = require('@jest/globals');
const { FastDatabaseUpdateManager } = require('../../../dataLayer/fastDatabaseUpdateManager');

function createPrototypedMock(RealClass) {
    const mock = Object.create(RealClass.prototype);
    return mock;
}

function defineGetter(obj, prop, value) {
    Object.defineProperty(obj, prop, { get: () => value, configurable: true });
}

const { ResourceLocatorFactory } = require('../../../operations/common/resourceLocatorFactory');
const { ResourceMerger } = require('../../../operations/common/resourceMerger');
const { PreSaveManager } = require('../../../preSaveHandlers/preSave');
const { DatabaseQueryFactory } = require('../../../dataLayer/databaseQueryFactory');
const { ConfigManager } = require('../../../utils/configManager');
const { Base64DataManager } = require('../../../dataLayer/base64DataManager');
const { FhirRequestInfo } = require('../../../utils/fhirRequestInfo');

function createMockFhirRequestInfo(overrides = {}) {
    const info = createPrototypedMock(FhirRequestInfo);
    info.requestId = overrides.requestId || 'test-req-id';
    info.userRequestId = overrides.userRequestId || 'user-req-1';
    info.method = overrides.method || 'PUT';
    info.headers = overrides.headers || {};
    return info;
}

function createMockDoc(overrides = {}) {
    // FastDatabaseUpdateManager works with plain objects, not Resource instances
    return {
        id: overrides.id || 'res-1',
        resourceType: overrides.resourceType || 'Patient',
        _uuid: overrides._uuid || 'uuid-res-1',
        _sourceAssigningAuthority: overrides._sourceAssigningAuthority || 'auth1',
        meta: {
            versionId: overrides.versionId || '1',
            source: 'test'
        }
    };
}

function createFastDatabaseUpdateManager(overrides = {}) {
    const resourceLocatorFactory = createPrototypedMock(ResourceLocatorFactory);
    const mockCollection = {
        insertOne: jestGlobal.fn().mockResolvedValue({ insertedId: 'id1' }),
        replaceOne: jestGlobal.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 })
    };
    const mockResourceLocator = {
        getCollectionForResourceAsync: jestGlobal.fn().mockResolvedValue(mockCollection)
    };
    resourceLocatorFactory.createResourceLocator = jestGlobal.fn().mockReturnValue(mockResourceLocator);

    const resourceMerger = createPrototypedMock(ResourceMerger);
    resourceMerger.fastMergeResourceAsync = jestGlobal.fn().mockResolvedValue({
        updatedResource: null,
        patches: null
    });
    resourceMerger.fastUpdateMeta = jestGlobal.fn().mockImplementation(({ patched_resource_incoming }) => patched_resource_incoming);

    const preSaveManager = createPrototypedMock(PreSaveManager);
    preSaveManager.preSaveAsync = jestGlobal.fn().mockImplementation(async ({ resource }) => resource);

    const databaseQueryFactory = createPrototypedMock(DatabaseQueryFactory);
    const mockDatabaseQueryManager = {
        fastFindOneAsync: jestGlobal.fn().mockResolvedValue(null)
    };
    databaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue(mockDatabaseQueryManager);

    const configManager = createPrototypedMock(ConfigManager);
    defineGetter(configManager, 'replaceRetries', 10);

    const base64DataManager = createPrototypedMock(Base64DataManager);
    base64DataManager.getLiveObjectRefs = jestGlobal.fn().mockReturnValue(new Map());
    base64DataManager.resolveWriteForExternalizedDataChange = jestGlobal.fn().mockImplementation(
        async (mergeResult) => mergeResult
    );
    base64DataManager.deleteSupersededLiveObjectsAsync = jestGlobal.fn().mockResolvedValue(undefined);
    base64DataManager.deleteOwnUploadedLiveObjectsAsync = jestGlobal.fn().mockResolvedValue(undefined);

    const inst = new FastDatabaseUpdateManager({
        resourceLocatorFactory,
        resourceMerger,
        preSaveManager,
        resourceType: overrides.resourceType || 'Patient',
        base_version: '4_0_0',
        databaseQueryFactory,
        configManager,
        base64DataManager
    });

    inst._mockCollection = mockCollection;
    inst._mockResourceMerger = resourceMerger;
    inst._mockDatabaseQueryManager = mockDatabaseQueryManager;
    inst._mockBase64DataManager = base64DataManager;
    return inst;
}

describe('FastDatabaseUpdateManager - null patches paths', () => {
    let manager;

    beforeEach(() => {
        manager = createFastDatabaseUpdateManager();
    });

    describe('replaceOneAsync', () => {
        test('returns patches:null when no resource in database (insert path)', async () => {
            const requestInfo = createMockFhirRequestInfo();
            const doc = createMockDoc({ id: 'p1', _uuid: 'u1', versionId: '1' });

            manager._mockDatabaseQueryManager.fastFindOneAsync.mockResolvedValue(null);

            const result = await manager.replaceOneAsync({
                base_version: '4_0_0',
                requestInfo,
                doc
            });

            expect(result.savedResource).toBeTruthy();
            expect(result.patches).toBeNull();
        });

        test('returns patches:null when resource is unchanged', async () => {
            const requestInfo = createMockFhirRequestInfo();
            const doc = createMockDoc({ id: 'p1', _uuid: 'u1', versionId: '1' });
            const existingDoc = createMockDoc({ id: 'p1', _uuid: 'u1', versionId: '1' });

            manager._mockDatabaseQueryManager.fastFindOneAsync.mockResolvedValue(existingDoc);
            manager._mockResourceMerger.fastMergeResourceAsync.mockResolvedValue({
                updatedResource: null,
                patches: null
            });
            manager._mockBase64DataManager.resolveWriteForExternalizedDataChange.mockResolvedValue(null);

            const result = await manager.replaceOneAsync({
                base_version: '4_0_0',
                requestInfo,
                doc
            });

            expect(result.savedResource).toBeNull();
            expect(result.patches).toBeNull();
        });

        test('successfully saves when merge returns updatedResource with patches', async () => {
            const requestInfo = createMockFhirRequestInfo();
            const doc = createMockDoc({ id: 'p1', _uuid: 'u1', versionId: '1' });
            const existingDoc = createMockDoc({ id: 'p1', _uuid: 'u1', versionId: '1' });
            const mergedDoc = createMockDoc({ id: 'p1', _uuid: 'u1', versionId: '2' });

            manager._mockDatabaseQueryManager.fastFindOneAsync.mockResolvedValue(existingDoc);
            manager._mockResourceMerger.fastMergeResourceAsync.mockResolvedValue({
                updatedResource: mergedDoc,
                patches: [{ op: 'replace', path: '/active', value: true }]
            });
            manager._mockBase64DataManager.resolveWriteForExternalizedDataChange.mockResolvedValue(mergedDoc);
            manager._mockCollection.replaceOne.mockResolvedValue({ matchedCount: 1 });

            const result = await manager.replaceOneAsync({
                base_version: '4_0_0',
                requestInfo,
                doc
            });

            expect(result.savedResource).toBeTruthy();
            expect(result.patches).toEqual([{ op: 'replace', path: '/active', value: true }]);
        });

        test('CRASHES when requestInfo.headers is null and retry logging accesses headers', async () => {
            /**
             * BUG: Line 207 of fastDatabaseUpdateManager.js:
             *   originService: requestInfo.headers['origin-service'] || 'unknown'
             * If requestInfo.headers is null/undefined, this crashes with:
             *   TypeError: Cannot read properties of null (reading 'origin-service')
             */
            const requestInfo = createPrototypedMock(FhirRequestInfo);
            requestInfo.requestId = 'test-req';
            requestInfo.userRequestId = 'user-req';
            requestInfo.method = 'PUT';
            requestInfo.headers = null; // Explicitly null headers

            const doc = createMockDoc({ id: 'p1', _uuid: 'u1', versionId: '2' });
            const existingDoc = createMockDoc({ id: 'p1', _uuid: 'u1', versionId: '1' });
            const mergedDoc = createMockDoc({ id: 'p1', _uuid: 'u1', versionId: '2' });

            manager._mockDatabaseQueryManager.fastFindOneAsync.mockResolvedValue(existingDoc);
            manager._mockResourceMerger.fastMergeResourceAsync.mockResolvedValue({
                updatedResource: mergedDoc,
                patches: [{ op: 'replace', path: '/name', value: [] }]
            });
            manager._mockBase64DataManager.resolveWriteForExternalizedDataChange.mockResolvedValue(mergedDoc);
            manager._mockCollection.replaceOne.mockResolvedValue({ matchedCount: 1 });

            // This should crash when accessing requestInfo.headers['origin-service']
            await expect(
                manager.replaceOneAsync({
                    base_version: '4_0_0',
                    requestInfo,
                    doc
                })
            ).rejects.toThrow();
        });

        test('retries and succeeds on second attempt after concurrent write', async () => {
            const requestInfo = createMockFhirRequestInfo();
            const doc = createMockDoc({ id: 'p1', _uuid: 'u1', versionId: '1' });
            const existingDoc = createMockDoc({ id: 'p1', _uuid: 'u1', versionId: '1' });
            const mergedDoc = createMockDoc({ id: 'p1', _uuid: 'u1', versionId: '2' });
            const reMergedDoc = createMockDoc({ id: 'p1', _uuid: 'u1', versionId: '3' });

            manager._mockDatabaseQueryManager.fastFindOneAsync
                .mockResolvedValueOnce(existingDoc)  // initial read
                .mockResolvedValueOnce(createMockDoc({ id: 'p1', _uuid: 'u1', versionId: '2' })); // retry read

            manager._mockResourceMerger.fastMergeResourceAsync
                .mockResolvedValueOnce({
                    updatedResource: mergedDoc,
                    patches: [{ op: 'add', path: '/active', value: true }]
                })
                .mockResolvedValueOnce({
                    updatedResource: reMergedDoc,
                    patches: [{ op: 'replace', path: '/active', value: false }]
                });
            manager._mockBase64DataManager.resolveWriteForExternalizedDataChange
                .mockResolvedValueOnce(mergedDoc)
                .mockResolvedValueOnce(reMergedDoc);

            manager._mockCollection.replaceOne
                .mockResolvedValueOnce({ matchedCount: 0 })  // first attempt fails
                .mockResolvedValueOnce({ matchedCount: 1 }); // second attempt succeeds

            const result = await manager.replaceOneAsync({
                base_version: '4_0_0',
                requestInfo,
                doc
            });

            expect(result.savedResource).toBeTruthy();
            expect(result.patches).toEqual([{ op: 'replace', path: '/active', value: false }]);
        });

        test('throws after exhausting retries', async () => {
            const requestInfo = createMockFhirRequestInfo();
            const doc = createMockDoc({ id: 'p1', _uuid: 'u1', versionId: '1' });
            const existingDoc = createMockDoc({ id: 'p1', _uuid: 'u1', versionId: '1' });
            const mergedDoc = createMockDoc({ id: 'p1', _uuid: 'u1', versionId: '2' });

            manager._mockDatabaseQueryManager.fastFindOneAsync.mockResolvedValue(existingDoc);
            manager._mockResourceMerger.fastMergeResourceAsync.mockResolvedValue({
                updatedResource: mergedDoc,
                patches: [{ op: 'add', path: '/active', value: true }]
            });
            manager._mockBase64DataManager.resolveWriteForExternalizedDataChange.mockResolvedValue(mergedDoc);
            manager._mockCollection.replaceOne.mockResolvedValue({ matchedCount: 0 });

            defineGetter(manager.configManager, 'replaceRetries', 2);

            await expect(
                manager.replaceOneAsync({
                    base_version: '4_0_0',
                    requestInfo,
                    doc
                })
            ).rejects.toThrow(/Unable to save resource/);
        });

        test('throws when resource disappears from database during retry', async () => {
            const requestInfo = createMockFhirRequestInfo();
            const doc = createMockDoc({ id: 'p1', _uuid: 'u1', versionId: '1' });
            const existingDoc = createMockDoc({ id: 'p1', _uuid: 'u1', versionId: '1' });
            const mergedDoc = createMockDoc({ id: 'p1', _uuid: 'u1', versionId: '2' });

            manager._mockDatabaseQueryManager.fastFindOneAsync
                .mockResolvedValueOnce(existingDoc)
                .mockResolvedValueOnce(null); // resource gone during retry

            manager._mockResourceMerger.fastMergeResourceAsync.mockResolvedValue({
                updatedResource: mergedDoc,
                patches: [{ op: 'add', path: '/active', value: true }]
            });
            manager._mockBase64DataManager.resolveWriteForExternalizedDataChange.mockResolvedValue(mergedDoc);
            manager._mockCollection.replaceOne.mockResolvedValue({ matchedCount: 0 });

            await expect(
                manager.replaceOneAsync({
                    base_version: '4_0_0',
                    requestInfo,
                    doc
                })
            ).rejects.toThrow(/Unable to read resource/);
        });

        test('returns null when retry merge shows no change', async () => {
            const requestInfo = createMockFhirRequestInfo();
            const doc = createMockDoc({ id: 'p1', _uuid: 'u1', versionId: '1' });
            const existingDoc = createMockDoc({ id: 'p1', _uuid: 'u1', versionId: '1' });
            const mergedDoc = createMockDoc({ id: 'p1', _uuid: 'u1', versionId: '2' });
            const updatedExistingDoc = createMockDoc({ id: 'p1', _uuid: 'u1', versionId: '2' });

            manager._mockDatabaseQueryManager.fastFindOneAsync
                .mockResolvedValueOnce(existingDoc)
                .mockResolvedValueOnce(updatedExistingDoc);

            manager._mockResourceMerger.fastMergeResourceAsync
                .mockResolvedValueOnce({
                    updatedResource: mergedDoc,
                    patches: [{ op: 'add', path: '/active', value: true }]
                })
                // On retry, merge shows no change (someone else already applied same change)
                .mockResolvedValueOnce({
                    updatedResource: null,
                    patches: null
                });
            manager._mockBase64DataManager.resolveWriteForExternalizedDataChange
                .mockResolvedValueOnce(mergedDoc)
                .mockResolvedValueOnce(null); // null means no change after reconciliation

            manager._mockCollection.replaceOne.mockResolvedValueOnce({ matchedCount: 0 });

            const result = await manager.replaceOneAsync({
                base_version: '4_0_0',
                requestInfo,
                doc
            });

            expect(result.savedResource).toBeNull();
            expect(result.patches).toBeNull();
        });
    });

    describe('insertOneAsync', () => {
        test('sets versionId to 1 when missing or invalid', async () => {
            const doc = createMockDoc({ id: 'p1', _uuid: 'u1', versionId: 'bad' });
            const requestInfo = createMockFhirRequestInfo();

            const result = await manager.insertOneAsync({ doc, requestInfo });
            expect(result.meta.versionId).toBe('1');
        });

        test('preserves valid versionId', async () => {
            const doc = createMockDoc({ id: 'p1', _uuid: 'u1', versionId: '5' });
            const requestInfo = createMockFhirRequestInfo();

            const result = await manager.insertOneAsync({ doc, requestInfo });
            expect(result.meta.versionId).toBe('5');
        });
    });
});
