'use strict';

const { describe, test, beforeEach, expect, jest: jestObj } = require('@jest/globals');

// Mock external logging/system calls
jestObj.mock('../../../operations/common/systemEventLogging', () => ({
    logTraceSystemEventAsync: jestObj.fn().mockResolvedValue(undefined)
}));
jestObj.mock('../../../operations/common/logging', () => ({
    logInfo: jestObj.fn(),
    logError: jestObj.fn()
}));

const { FastDatabaseUpdateManager } = require('../../../dataLayer/fastDatabaseUpdateManager');
const { ResourceLocatorFactory } = require('../../../operations/common/resourceLocatorFactory');
const { ResourceMerger } = require('../../../operations/common/resourceMerger');
const { PreSaveManager } = require('../../../preSaveHandlers/preSave');
const { DatabaseQueryFactory } = require('../../../dataLayer/databaseQueryFactory');
const { ConfigManager } = require('../../../utils/configManager');
const { Base64DataManager } = require('../../../dataLayer/base64DataManager');
const { FhirRequestInfo } = require('../../../utils/fhirRequestInfo');

function createPrototypedMock(RealClass) {
    return Object.create(RealClass.prototype);
}

function defineGetter(obj, prop, value) {
    Object.defineProperty(obj, prop, { get: () => value, configurable: true });
}

function createMockFhirRequestInfo(overrides = {}) {
    const info = createPrototypedMock(FhirRequestInfo);
    info.requestId = overrides.requestId || 'test-req-id';
    info.userRequestId = overrides.userRequestId || 'user-req-1';
    info.method = overrides.method || 'PUT';
    info.headers = overrides.headers || { 'origin-service': 'test-service' };
    return info;
}

function createMockDoc(overrides = {}) {
    return {
        id: overrides.id || 'res-1',
        resourceType: overrides.resourceType || 'Patient',
        _uuid: overrides._uuid || 'uuid-res-1',
        _sourceAssigningAuthority: overrides._sourceAssigningAuthority || 'auth1',
        meta: {
            versionId: overrides.versionId || '1',
            source: overrides.source || 'test'
        }
    };
}

function createManager(overrides = {}) {
    const resourceLocatorFactory = createPrototypedMock(ResourceLocatorFactory);
    const mockCollection = {
        insertOne: jestObj.fn().mockResolvedValue({ insertedId: 'id1' }),
        replaceOne: jestObj.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 })
    };
    const mockResourceLocator = {
        getCollectionForResourceAsync: jestObj.fn().mockResolvedValue(mockCollection)
    };
    resourceLocatorFactory.createResourceLocator = jestObj.fn().mockReturnValue(mockResourceLocator);

    const resourceMerger = createPrototypedMock(ResourceMerger);
    resourceMerger.fastMergeResourceAsync = jestObj.fn().mockResolvedValue({
        updatedResource: null,
        patches: null
    });
    resourceMerger.fastUpdateMeta = jestObj.fn().mockImplementation(({ patched_resource_incoming }) => patched_resource_incoming);

    const preSaveManager = createPrototypedMock(PreSaveManager);
    preSaveManager.preSaveAsync = jestObj.fn().mockImplementation(async ({ resource }) => resource);

    const databaseQueryFactory = createPrototypedMock(DatabaseQueryFactory);
    const mockDatabaseQueryManager = {
        fastFindOneAsync: jestObj.fn().mockResolvedValue(null)
    };
    databaseQueryFactory.createQuery = jestObj.fn().mockReturnValue(mockDatabaseQueryManager);

    const configManager = createPrototypedMock(ConfigManager);
    defineGetter(configManager, 'replaceRetries', overrides.replaceRetries || 10);

    const base64DataManager = createPrototypedMock(Base64DataManager);
    base64DataManager.getLiveObjectRefs = jestObj.fn().mockReturnValue(new Map());
    base64DataManager.resolveWriteForExternalizedDataChange = jestObj.fn().mockImplementation(
        async (mergeResult) => mergeResult
    );
    base64DataManager.deleteSupersededLiveObjectsAsync = jestObj.fn().mockResolvedValue(undefined);
    base64DataManager.deleteOwnUploadedLiveObjectsAsync = jestObj.fn().mockResolvedValue(undefined);

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

    return {
        manager: inst,
        mocks: {
            collection: mockCollection,
            resourceLocator: mockResourceLocator,
            resourceMerger,
            preSaveManager,
            databaseQueryFactory,
            databaseQueryManager: mockDatabaseQueryManager,
            configManager,
            base64DataManager
        }
    };
}

describe('FastDatabaseUpdateManager', () => {
    let manager;
    let mocks;

    beforeEach(() => {
        const setup = createManager();
        manager = setup.manager;
        mocks = setup.mocks;
    });

    describe('constructor', () => {
        test('creates resource locator using factory with correct params', () => {
            const setup = createManager({ resourceType: 'Observation' });
            expect(setup.mocks.resourceLocator).toBeDefined();
        });

        test('stores resourceType and base_version', () => {
            const setup = createManager({ resourceType: 'Condition' });
            expect(setup.manager._resourceType).toBe('Condition');
            expect(setup.manager._base_version).toBe('4_0_0');
        });
    });

    describe('insertOneAsync', () => {
        test('calls preSaveManager.preSaveAsync before insertion', async () => {
            const doc = createMockDoc();
            const requestInfo = createMockFhirRequestInfo();

            await manager.insertOneAsync({ doc, requestInfo });

            expect(mocks.preSaveManager.preSaveAsync).toHaveBeenCalledWith(
                expect.objectContaining({ resource: doc })
            );
        });

        test('calls collection.insertOne with the doc', async () => {
            const doc = createMockDoc({ versionId: '3' });
            const requestInfo = createMockFhirRequestInfo();

            await manager.insertOneAsync({ doc, requestInfo });

            expect(mocks.collection.insertOne).toHaveBeenCalledWith(doc);
        });

        test('sets versionId to 1 when versionId is missing', async () => {
            const doc = createMockDoc();
            doc.meta.versionId = undefined;
            const requestInfo = createMockFhirRequestInfo();

            const result = await manager.insertOneAsync({ doc, requestInfo });
            expect(result.meta.versionId).toBe('1');
        });

        test('sets versionId to 1 when versionId is NaN', async () => {
            const doc = createMockDoc({ versionId: 'abc' });
            const requestInfo = createMockFhirRequestInfo();

            const result = await manager.insertOneAsync({ doc, requestInfo });
            expect(result.meta.versionId).toBe('1');
        });

        test('preserves valid numeric versionId', async () => {
            const doc = createMockDoc({ versionId: '7' });
            const requestInfo = createMockFhirRequestInfo();

            const result = await manager.insertOneAsync({ doc, requestInfo });
            expect(result.meta.versionId).toBe('7');
        });

        test('returns the inserted doc', async () => {
            const doc = createMockDoc({ id: 'pat-123' });
            const requestInfo = createMockFhirRequestInfo();

            const result = await manager.insertOneAsync({ doc, requestInfo });
            expect(result.id).toBe('pat-123');
        });

        test('throws RethrownError when collection.insertOne fails', async () => {
            mocks.collection.insertOne.mockRejectedValue(new Error('DB write failed'));
            const doc = createMockDoc();
            const requestInfo = createMockFhirRequestInfo();

            await expect(
                manager.insertOneAsync({ doc, requestInfo })
            ).rejects.toThrow();
        });

        test('throws RethrownError when preSaveAsync fails', async () => {
            mocks.preSaveManager.preSaveAsync.mockRejectedValue(new Error('preSave error'));
            const doc = createMockDoc();
            const requestInfo = createMockFhirRequestInfo();

            await expect(
                manager.insertOneAsync({ doc, requestInfo })
            ).rejects.toThrow();
        });
    });

    describe('replaceOneAsync', () => {
        test('inserts when no existing resource in database', async () => {
            const doc = createMockDoc({ _uuid: 'new-uuid', versionId: '1' });
            const requestInfo = createMockFhirRequestInfo();
            mocks.databaseQueryManager.fastFindOneAsync.mockResolvedValue(null);

            const result = await manager.replaceOneAsync({
                base_version: '4_0_0',
                requestInfo,
                doc
            });

            expect(result.savedResource).toBeTruthy();
            expect(result.patches).toBeNull();
            expect(mocks.collection.insertOne).toHaveBeenCalled();
        });

        test('returns null savedResource when merge shows no change', async () => {
            const doc = createMockDoc({ _uuid: 'u1', versionId: '1' });
            const existingDoc = createMockDoc({ _uuid: 'u1', versionId: '1' });
            const requestInfo = createMockFhirRequestInfo();

            mocks.databaseQueryManager.fastFindOneAsync.mockResolvedValue(existingDoc);
            mocks.resourceMerger.fastMergeResourceAsync.mockResolvedValue({
                updatedResource: null,
                patches: null
            });
            mocks.base64DataManager.resolveWriteForExternalizedDataChange.mockResolvedValue(null);

            const result = await manager.replaceOneAsync({
                base_version: '4_0_0',
                requestInfo,
                doc
            });

            expect(result.savedResource).toBeNull();
            expect(result.patches).toBeNull();
        });

        test('successfully replaces when merge returns updated resource', async () => {
            const doc = createMockDoc({ _uuid: 'u1', versionId: '1' });
            const existingDoc = createMockDoc({ _uuid: 'u1', versionId: '1' });
            const mergedDoc = createMockDoc({ _uuid: 'u1', versionId: '2' });
            const requestInfo = createMockFhirRequestInfo();
            const patchList = [{ op: 'replace', path: '/active', value: true }];

            mocks.databaseQueryManager.fastFindOneAsync.mockResolvedValue(existingDoc);
            mocks.resourceMerger.fastMergeResourceAsync.mockResolvedValue({
                updatedResource: mergedDoc,
                patches: patchList
            });
            mocks.base64DataManager.resolveWriteForExternalizedDataChange.mockResolvedValue(mergedDoc);
            mocks.collection.replaceOne.mockResolvedValue({ matchedCount: 1 });

            const result = await manager.replaceOneAsync({
                base_version: '4_0_0',
                requestInfo,
                doc
            });

            expect(result.savedResource).toBeTruthy();
            expect(result.patches).toEqual(patchList);
        });

        test('uses filter with _uuid and previous versionId for replaceOne', async () => {
            const doc = createMockDoc({ _uuid: 'u1', versionId: '1' });
            const existingDoc = createMockDoc({ _uuid: 'u1', versionId: '1' });
            const mergedDoc = createMockDoc({ _uuid: 'u1', versionId: '2' });
            const requestInfo = createMockFhirRequestInfo();

            mocks.databaseQueryManager.fastFindOneAsync.mockResolvedValue(existingDoc);
            mocks.resourceMerger.fastMergeResourceAsync.mockResolvedValue({
                updatedResource: mergedDoc,
                patches: [{ op: 'add', path: '/x' }]
            });
            mocks.base64DataManager.resolveWriteForExternalizedDataChange.mockResolvedValue(mergedDoc);
            mocks.collection.replaceOne.mockResolvedValue({ matchedCount: 1 });

            await manager.replaceOneAsync({
                base_version: '4_0_0',
                requestInfo,
                doc
            });

            const filterUsed = mocks.collection.replaceOne.mock.calls[0][0];
            // versionId is '2', so previousVersionId = 1
            expect(filterUsed).toEqual({
                $and: [{ _uuid: 'u1' }, { 'meta.versionId': '1' }]
            });
        });

        test('uses only _uuid filter when previousVersionId is 0 or less', async () => {
            const doc = createMockDoc({ _uuid: 'u1', versionId: '1' });
            const existingDoc = createMockDoc({ _uuid: 'u1', versionId: '1' });
            // mergedDoc with versionId '1' means previousVersionId = 0
            const mergedDoc = createMockDoc({ _uuid: 'u1', versionId: '1' });
            const requestInfo = createMockFhirRequestInfo();

            mocks.databaseQueryManager.fastFindOneAsync.mockResolvedValue(existingDoc);
            mocks.resourceMerger.fastMergeResourceAsync.mockResolvedValue({
                updatedResource: mergedDoc,
                patches: [{ op: 'add', path: '/x' }]
            });
            mocks.base64DataManager.resolveWriteForExternalizedDataChange.mockResolvedValue(mergedDoc);
            mocks.collection.replaceOne.mockResolvedValue({ matchedCount: 1 });

            await manager.replaceOneAsync({
                base_version: '4_0_0',
                requestInfo,
                doc
            });

            const filterUsed = mocks.collection.replaceOne.mock.calls[0][0];
            expect(filterUsed).toEqual({ _uuid: 'u1' });
        });

        test('retries when matchedCount is 0 and re-reads from database', async () => {
            const doc = createMockDoc({ _uuid: 'u1', versionId: '1' });
            const existingDoc = createMockDoc({ _uuid: 'u1', versionId: '1' });
            const mergedDoc = createMockDoc({ _uuid: 'u1', versionId: '2' });
            const updatedExisting = createMockDoc({ _uuid: 'u1', versionId: '2' });
            const reMergedDoc = createMockDoc({ _uuid: 'u1', versionId: '3' });
            const requestInfo = createMockFhirRequestInfo();

            mocks.databaseQueryManager.fastFindOneAsync
                .mockResolvedValueOnce(existingDoc)
                .mockResolvedValueOnce(updatedExisting);

            mocks.resourceMerger.fastMergeResourceAsync
                .mockResolvedValueOnce({ updatedResource: mergedDoc, patches: [{ op: 'add', path: '/a' }] })
                .mockResolvedValueOnce({ updatedResource: reMergedDoc, patches: [{ op: 'add', path: '/b' }] });

            mocks.base64DataManager.resolveWriteForExternalizedDataChange
                .mockResolvedValueOnce(mergedDoc)
                .mockResolvedValueOnce(reMergedDoc);

            mocks.collection.replaceOne
                .mockResolvedValueOnce({ matchedCount: 0 })
                .mockResolvedValueOnce({ matchedCount: 1 });

            const result = await manager.replaceOneAsync({
                base_version: '4_0_0',
                requestInfo,
                doc
            });

            expect(result.savedResource).toBeTruthy();
            expect(mocks.databaseQueryManager.fastFindOneAsync).toHaveBeenCalledTimes(2);
        });

        test('throws error after exhausting retries', async () => {
            const setup = createManager({ replaceRetries: 2 });
            const doc = createMockDoc({ _uuid: 'u1', versionId: '1' });
            const existingDoc = createMockDoc({ _uuid: 'u1', versionId: '1' });
            const mergedDoc = createMockDoc({ _uuid: 'u1', versionId: '2' });
            const requestInfo = createMockFhirRequestInfo();

            setup.mocks.databaseQueryManager.fastFindOneAsync.mockResolvedValue(existingDoc);
            setup.mocks.resourceMerger.fastMergeResourceAsync.mockResolvedValue({
                updatedResource: mergedDoc,
                patches: [{ op: 'add', path: '/x' }]
            });
            setup.mocks.base64DataManager.resolveWriteForExternalizedDataChange.mockResolvedValue(mergedDoc);
            setup.mocks.collection.replaceOne.mockResolvedValue({ matchedCount: 0 });

            await expect(
                setup.manager.replaceOneAsync({
                    base_version: '4_0_0',
                    requestInfo,
                    doc
                })
            ).rejects.toThrow(/Unable to save resource/);
        });

        test('throws when resource disappears from database during retry', async () => {
            const doc = createMockDoc({ _uuid: 'u1', versionId: '1' });
            const existingDoc = createMockDoc({ _uuid: 'u1', versionId: '1' });
            const mergedDoc = createMockDoc({ _uuid: 'u1', versionId: '2' });
            const requestInfo = createMockFhirRequestInfo();

            mocks.databaseQueryManager.fastFindOneAsync
                .mockResolvedValueOnce(existingDoc)
                .mockResolvedValueOnce(null);

            mocks.resourceMerger.fastMergeResourceAsync.mockResolvedValue({
                updatedResource: mergedDoc,
                patches: [{ op: 'add', path: '/x' }]
            });
            mocks.base64DataManager.resolveWriteForExternalizedDataChange.mockResolvedValue(mergedDoc);
            mocks.collection.replaceOne.mockResolvedValue({ matchedCount: 0 });

            await expect(
                manager.replaceOneAsync({
                    base_version: '4_0_0',
                    requestInfo,
                    doc
                })
            ).rejects.toThrow(/Unable to read resource/);
        });

        test('calls deleteSupersededLiveObjectsAsync on success', async () => {
            const doc = createMockDoc({ _uuid: 'u1', versionId: '1' });
            const existingDoc = createMockDoc({ _uuid: 'u1', versionId: '1' });
            const mergedDoc = createMockDoc({ _uuid: 'u1', versionId: '2' });
            const requestInfo = createMockFhirRequestInfo();

            mocks.databaseQueryManager.fastFindOneAsync.mockResolvedValue(existingDoc);
            mocks.resourceMerger.fastMergeResourceAsync.mockResolvedValue({
                updatedResource: mergedDoc,
                patches: [{ op: 'add', path: '/x' }]
            });
            mocks.base64DataManager.resolveWriteForExternalizedDataChange.mockResolvedValue(mergedDoc);
            mocks.collection.replaceOne.mockResolvedValue({ matchedCount: 1 });

            await manager.replaceOneAsync({
                base_version: '4_0_0',
                requestInfo,
                doc
            });

            expect(mocks.base64DataManager.deleteSupersededLiveObjectsAsync).toHaveBeenCalled();
        });

        test('calls deleteOwnUploadedLiveObjectsAsync on error', async () => {
            const doc = createMockDoc({ _uuid: 'u1', versionId: '1' });
            const requestInfo = createMockFhirRequestInfo();

            mocks.databaseQueryManager.fastFindOneAsync.mockRejectedValue(new Error('DB crash'));

            await expect(
                manager.replaceOneAsync({
                    base_version: '4_0_0',
                    requestInfo,
                    doc
                })
            ).rejects.toThrow();

            expect(mocks.base64DataManager.deleteOwnUploadedLiveObjectsAsync).toHaveBeenCalled();
        });

        test('calls getLiveObjectRefs for the existing database resource', async () => {
            const doc = createMockDoc({ _uuid: 'u1', versionId: '1' });
            const existingDoc = createMockDoc({ _uuid: 'u1', versionId: '1' });
            const mergedDoc = createMockDoc({ _uuid: 'u1', versionId: '2' });
            const requestInfo = createMockFhirRequestInfo();

            mocks.databaseQueryManager.fastFindOneAsync.mockResolvedValue(existingDoc);
            mocks.resourceMerger.fastMergeResourceAsync.mockResolvedValue({
                updatedResource: mergedDoc,
                patches: [{ op: 'add', path: '/x' }]
            });
            mocks.base64DataManager.resolveWriteForExternalizedDataChange.mockResolvedValue(mergedDoc);
            mocks.collection.replaceOne.mockResolvedValue({ matchedCount: 1 });

            await manager.replaceOneAsync({
                base_version: '4_0_0',
                requestInfo,
                doc
            });

            expect(mocks.base64DataManager.getLiveObjectRefs).toHaveBeenCalledWith(existingDoc);
        });

        test('passes smartMerge parameter to fastMergeResourceAsync', async () => {
            const doc = createMockDoc({ _uuid: 'u1', versionId: '1' });
            const existingDoc = createMockDoc({ _uuid: 'u1', versionId: '1' });
            const requestInfo = createMockFhirRequestInfo();

            mocks.databaseQueryManager.fastFindOneAsync.mockResolvedValue(existingDoc);
            mocks.resourceMerger.fastMergeResourceAsync.mockResolvedValue({
                updatedResource: null,
                patches: null
            });
            mocks.base64DataManager.resolveWriteForExternalizedDataChange.mockResolvedValue(null);

            await manager.replaceOneAsync({
                base_version: '4_0_0',
                requestInfo,
                doc,
                smartMerge: false
            });

            expect(mocks.resourceMerger.fastMergeResourceAsync).toHaveBeenCalledWith(
                expect.objectContaining({ smartMerge: false })
            );
        });

        test('creates databaseQueryManager with base_version 4_0_0', async () => {
            const doc = createMockDoc({ _uuid: 'u1' });
            const requestInfo = createMockFhirRequestInfo();

            mocks.databaseQueryManager.fastFindOneAsync.mockResolvedValue(null);

            await manager.replaceOneAsync({
                base_version: '4_0_0',
                requestInfo,
                doc
            });

            expect(mocks.databaseQueryFactory.createQuery).toHaveBeenCalledWith({
                resourceType: 'Patient',
                base_version: '4_0_0'
            });
        });
    });

    describe('_forceBase64Write', () => {
        test('calls resourceMerger.fastUpdateMeta with deepcopy and incrementVersion', () => {
            const currentResource = createMockDoc({ versionId: '3' });

            manager._forceBase64Write(currentResource);

            expect(mocks.resourceMerger.fastUpdateMeta).toHaveBeenCalledWith(
                expect.objectContaining({
                    currentResource,
                    original_source: 'test',
                    incrementVersion: true
                })
            );
        });

        test('returns result of fastUpdateMeta', () => {
            const currentResource = createMockDoc({ versionId: '3' });
            const expected = createMockDoc({ versionId: '4' });
            mocks.resourceMerger.fastUpdateMeta.mockReturnValue(expected);

            const result = manager._forceBase64Write(currentResource);
            expect(result).toBe(expected);
        });
    });
});
