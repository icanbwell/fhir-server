'use strict';

const { describe, test, beforeEach, expect, jest: jestGlobal } = require('@jest/globals');
const { DatabaseUpdateManager } = require('../../../dataLayer/databaseUpdateManager');
const { RequestSpecificCache } = require('../../../utils/requestSpecificCache');

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
const Resource = require('../../../fhir/classes/4_0_0/resources/resource');

function createMockFhirRequestInfo(overrides = {}) {
    const info = createPrototypedMock(FhirRequestInfo);
    info.requestId = overrides.requestId || 'test-req-id';
    info.userRequestId = overrides.userRequestId || 'user-req-1';
    info.method = overrides.method || 'PUT';
    info.headers = overrides.headers || {};
    return info;
}

function createMockResource(overrides = {}) {
    const resourceType = overrides.resourceType || 'Patient';
    const { getResource } = require('../../../operations/common/getResource');
    const { VERSIONS } = require('../../../middleware/fhir/utils/constants');
    let ResourceClass;
    try {
        ResourceClass = getResource(VERSIONS['4_0_0'], resourceType);
    } catch (e) {
        ResourceClass = Resource;
    }
    const r = new ResourceClass({
        id: overrides.id || 'res-1',
        meta: { versionId: overrides.versionId || '1', source: 'test' }
    });
    r._uuid = overrides._uuid || 'uuid-res-1';
    r._sourceAssigningAuthority = overrides._sourceAssigningAuthority || 'auth1';
    return r;
}

function createDatabaseUpdateManager(overrides = {}) {
    // ResourceLocatorFactory needs special handling since constructor calls createResourceLocator
    const resourceLocatorFactory = createPrototypedMock(ResourceLocatorFactory);
    const mockCollection = {
        insertOne: jestGlobal.fn().mockResolvedValue({ insertedId: 'id1' }),
        replaceOne: jestGlobal.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 })
    };
    const mockResourceLocator = {
        getCollectionForResourceAsync: jestGlobal.fn().mockResolvedValue(mockCollection),
        getHistoryCollectionNameForResource: jestGlobal.fn().mockReturnValue('Patient_4_0_0_History'),
        getCollectionByNameAsync: jestGlobal.fn().mockResolvedValue(mockCollection)
    };
    resourceLocatorFactory.createResourceLocator = jestGlobal.fn().mockReturnValue(mockResourceLocator);

    const resourceMerger = createPrototypedMock(ResourceMerger);
    resourceMerger.mergeResourceAsync = jestGlobal.fn().mockResolvedValue({
        updatedResource: null,
        patches: null
    });
    resourceMerger.updateMeta = jestGlobal.fn().mockImplementation(({ patched_resource_incoming }) => patched_resource_incoming);

    const preSaveManager = createPrototypedMock(PreSaveManager);
    preSaveManager.preSaveAsync = jestGlobal.fn().mockImplementation(async ({ resource }) => resource);

    const databaseQueryFactory = createPrototypedMock(DatabaseQueryFactory);
    const mockDatabaseQueryManager = {
        findOneAsync: jestGlobal.fn().mockResolvedValue(null)
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

    const inst = new DatabaseUpdateManager({
        resourceLocatorFactory,
        resourceMerger,
        preSaveManager,
        resourceType: overrides.resourceType || 'Patient',
        base_version: '4_0_0',
        databaseQueryFactory,
        configManager,
        base64DataManager
    });

    // expose internals for test manipulation
    inst._mockCollection = mockCollection;
    inst._mockResourceMerger = resourceMerger;
    inst._mockDatabaseQueryManager = mockDatabaseQueryManager;
    inst._mockBase64DataManager = base64DataManager;
    return inst;
}

describe('DatabaseUpdateManager - null patches paths', () => {
    let manager;

    beforeEach(() => {
        manager = createDatabaseUpdateManager();
    });

    describe('replaceOneAsync', () => {
        test('returns patches:null when no resource in database (insert path)', async () => {
            const requestInfo = createMockFhirRequestInfo();
            const doc = createMockResource({ id: 'p1', _uuid: 'u1', versionId: '1' });

            // findOneAsync returns null -> triggers insert path
            manager._mockDatabaseQueryManager.findOneAsync.mockResolvedValue(null);

            const result = await manager.replaceOneAsync({
                base_version: '4_0_0',
                requestInfo,
                doc
            });

            expect(result.savedResource).toBeTruthy();
            expect(result.patches).toBeNull();
        });

        test('returns patches:null when resource is unchanged (merge returns null)', async () => {
            const requestInfo = createMockFhirRequestInfo();
            const doc = createMockResource({ id: 'p1', _uuid: 'u1', versionId: '1' });
            const existingDoc = createMockResource({ id: 'p1', _uuid: 'u1', versionId: '1' });

            manager._mockDatabaseQueryManager.findOneAsync.mockResolvedValue(existingDoc);
            manager._mockResourceMerger.mergeResourceAsync.mockResolvedValue({
                updatedResource: null,
                patches: null
            });
            // resolveWriteForExternalizedDataChange receives null and passes through
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
            const doc = createMockResource({ id: 'p1', _uuid: 'u1', versionId: '1' });
            const existingDoc = createMockResource({ id: 'p1', _uuid: 'u1', versionId: '1' });
            const mergedDoc = createMockResource({ id: 'p1', _uuid: 'u1', versionId: '2' });

            manager._mockDatabaseQueryManager.findOneAsync.mockResolvedValue(existingDoc);
            manager._mockResourceMerger.mergeResourceAsync.mockResolvedValue({
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
             * BUG: Line 243 of databaseUpdateManager.js:
             *   originService: requestInfo.headers['origin-service'] || 'unknown'
             * If requestInfo.headers is null/undefined, this crashes with:
             *   TypeError: Cannot read properties of null (reading 'origin-service')
             *
             * While FhirRequestInfo constructor typically sets headers, there's no guard
             * in the replaceOneAsync method itself.
             */
            const requestInfo = createPrototypedMock(FhirRequestInfo);
            requestInfo.requestId = 'test-req';
            requestInfo.userRequestId = 'user-req';
            requestInfo.method = 'PUT';
            requestInfo.headers = null; // Explicitly null headers

            const doc = createMockResource({ id: 'p1', _uuid: 'u1', versionId: '2' });
            const existingDoc = createMockResource({ id: 'p1', _uuid: 'u1', versionId: '1' });
            const mergedDoc = createMockResource({ id: 'p1', _uuid: 'u1', versionId: '2' });

            manager._mockDatabaseQueryManager.findOneAsync.mockResolvedValue(existingDoc);
            manager._mockResourceMerger.mergeResourceAsync.mockResolvedValue({
                updatedResource: mergedDoc,
                patches: [{ op: 'replace', path: '/name', value: [] }]
            });
            manager._mockBase64DataManager.resolveWriteForExternalizedDataChange.mockResolvedValue(mergedDoc);
            // First replaceOne succeeds so we reach the log line
            manager._mockCollection.replaceOne.mockResolvedValue({ matchedCount: 1 });

            // EXPECTED: correct behavior (will fail until bug is fixed)
            // Should handle null headers gracefully without crashing
            const result = await manager.replaceOneAsync({
                base_version: '4_0_0',
                requestInfo,
                doc
            });
            expect(result.savedResource).toBeTruthy();
        });

        test('retries on matchedCount=0 and re-merges', async () => {
            const requestInfo = createMockFhirRequestInfo();
            const doc = createMockResource({ id: 'p1', _uuid: 'u1', versionId: '1' });
            const existingDoc = createMockResource({ id: 'p1', _uuid: 'u1', versionId: '1' });
            const mergedDoc = createMockResource({ id: 'p1', _uuid: 'u1', versionId: '2' });
            const reMergedDoc = createMockResource({ id: 'p1', _uuid: 'u1', versionId: '3' });

            manager._mockDatabaseQueryManager.findOneAsync.mockResolvedValue(existingDoc);
            manager._mockResourceMerger.mergeResourceAsync
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

            // First attempt: matchedCount=0 (concurrent write)
            // Second attempt: matchedCount=1 (success)
            manager._mockCollection.replaceOne
                .mockResolvedValueOnce({ matchedCount: 0 })
                .mockResolvedValueOnce({ matchedCount: 1 });

            // On retry, findOneAsync returns the updated DB version
            const updatedExistingDoc = createMockResource({ id: 'p1', _uuid: 'u1', versionId: '2' });
            manager._mockDatabaseQueryManager.findOneAsync
                .mockResolvedValueOnce(existingDoc) // initial read
                .mockResolvedValueOnce(updatedExistingDoc); // retry read

            const result = await manager.replaceOneAsync({
                base_version: '4_0_0',
                requestInfo,
                doc
            });

            expect(result.savedResource).toBeTruthy();
            // The final patches come from the second merge
            expect(result.patches).toEqual([{ op: 'replace', path: '/active', value: false }]);
        });

        test('throws after exhausting retries', async () => {
            const requestInfo = createMockFhirRequestInfo();
            const doc = createMockResource({ id: 'p1', _uuid: 'u1', versionId: '1' });
            const existingDoc = createMockResource({ id: 'p1', _uuid: 'u1', versionId: '1' });
            const mergedDoc = createMockResource({ id: 'p1', _uuid: 'u1', versionId: '2' });

            manager._mockDatabaseQueryManager.findOneAsync.mockResolvedValue(existingDoc);
            manager._mockResourceMerger.mergeResourceAsync.mockResolvedValue({
                updatedResource: mergedDoc,
                patches: [{ op: 'add', path: '/active', value: true }]
            });
            manager._mockBase64DataManager.resolveWriteForExternalizedDataChange.mockResolvedValue(mergedDoc);

            // Always returns matchedCount=0 (simulating constant concurrent writes)
            manager._mockCollection.replaceOne.mockResolvedValue({ matchedCount: 0 });

            // Override replaceRetries to just 2 to speed up test
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
            const doc = createMockResource({ id: 'p1', _uuid: 'u1', versionId: '1' });
            const existingDoc = createMockResource({ id: 'p1', _uuid: 'u1', versionId: '1' });
            const mergedDoc = createMockResource({ id: 'p1', _uuid: 'u1', versionId: '2' });

            manager._mockDatabaseQueryManager.findOneAsync
                .mockResolvedValueOnce(existingDoc)  // initial read
                .mockResolvedValueOnce(null);        // retry read - resource gone!

            manager._mockResourceMerger.mergeResourceAsync.mockResolvedValue({
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
    });

    describe('insertOneAsync', () => {
        test('sets versionId to 1 when missing', async () => {
            const doc = createMockResource({ id: 'p1', _uuid: 'u1', versionId: 'invalid' });
            const requestInfo = createMockFhirRequestInfo();

            const result = await manager.insertOneAsync({ doc, requestInfo });
            expect(result.meta.versionId).toBe('1');
        });
    });
});
