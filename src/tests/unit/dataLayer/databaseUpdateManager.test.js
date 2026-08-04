'use strict';

const { describe, test, beforeEach, expect, jest: jestObj } = require('@jest/globals');
const { DatabaseUpdateManager } = require('../../../dataLayer/databaseUpdateManager');

const { ResourceLocatorFactory } = require('../../../operations/common/resourceLocatorFactory');
const { ResourceMerger } = require('../../../operations/common/resourceMerger');
const { PreSaveManager } = require('../../../preSaveHandlers/preSave');
const { DatabaseQueryFactory } = require('../../../dataLayer/databaseQueryFactory');
const { ConfigManager } = require('../../../utils/configManager');
const { Base64DataManager } = require('../../../dataLayer/base64DataManager');
const { FhirRequestInfo } = require('../../../utils/fhirRequestInfo');
const Resource = require('../../../fhir/classes/4_0_0/resources/resource');
const { RethrownError } = require('../../../utils/rethrownError');

function createPrototypedMock(RealClass) {
    const mock = Object.create(RealClass.prototype);
    return mock;
}

function defineGetter(obj, prop, value) {
    Object.defineProperty(obj, prop, { get: () => value, configurable: true });
}

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
    const resourceLocatorFactory = createPrototypedMock(ResourceLocatorFactory);
    const mockCollection = {
        insertOne: jestObj.fn().mockResolvedValue({ insertedId: 'id1' }),
        replaceOne: jestObj.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
        collectionName: 'Patient_4_0_0_History'
    };
    const mockResourceLocator = {
        getCollectionForResourceAsync: jestObj.fn().mockResolvedValue(mockCollection),
        getHistoryCollectionNameForResource: jestObj.fn().mockReturnValue('Patient_4_0_0_History'),
        getCollectionByNameAsync: jestObj.fn().mockResolvedValue(mockCollection)
    };
    resourceLocatorFactory.createResourceLocator = jestObj.fn().mockReturnValue(mockResourceLocator);

    const resourceMerger = createPrototypedMock(ResourceMerger);
    resourceMerger.mergeResourceAsync = jestObj.fn().mockResolvedValue({
        updatedResource: null,
        patches: null
    });
    resourceMerger.updateMeta = jestObj.fn().mockImplementation(({ patched_resource_incoming }) => patched_resource_incoming);

    const preSaveManager = createPrototypedMock(PreSaveManager);
    preSaveManager.preSaveAsync = jestObj.fn().mockImplementation(async ({ resource }) => resource);

    const databaseQueryFactory = createPrototypedMock(DatabaseQueryFactory);
    const mockDatabaseQueryManager = {
        findOneAsync: jestObj.fn().mockResolvedValue(null)
    };
    databaseQueryFactory.createQuery = jestObj.fn().mockReturnValue(mockDatabaseQueryManager);

    const configManager = createPrototypedMock(ConfigManager);
    defineGetter(configManager, 'replaceRetries', 10);

    const base64DataManager = createPrototypedMock(Base64DataManager);
    base64DataManager.getLiveObjectRefs = jestObj.fn().mockReturnValue(new Map());
    base64DataManager.resolveWriteForExternalizedDataChange = jestObj.fn().mockImplementation(
        async (mergeResult) => mergeResult
    );
    base64DataManager.deleteSupersededLiveObjectsAsync = jestObj.fn().mockResolvedValue(undefined);
    base64DataManager.deleteOwnUploadedLiveObjectsAsync = jestObj.fn().mockResolvedValue(undefined);

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

    inst._mockCollection = mockCollection;
    inst._mockResourceMerger = resourceMerger;
    inst._mockPreSaveManager = preSaveManager;
    inst._mockDatabaseQueryManager = mockDatabaseQueryManager;
    inst._mockBase64DataManager = base64DataManager;
    inst._mockResourceLocator = mockResourceLocator;
    return inst;
}

describe('DatabaseUpdateManager', () => {
    let manager;

    beforeEach(() => {
        manager = createDatabaseUpdateManager();
    });

    describe('insertOneAsync', () => {
        test('inserts a document and returns it', async () => {
            const doc = createMockResource({ id: 'p1', _uuid: 'u1', versionId: '1' });
            const requestInfo = createMockFhirRequestInfo();

            const result = await manager.insertOneAsync({ doc, requestInfo });

            expect(result).toBeTruthy();
            expect(result.id).toBe('p1');
            expect(manager._mockCollection.insertOne).toHaveBeenCalledTimes(1);
        });

        test('calls preSaveManager before inserting', async () => {
            const doc = createMockResource({ id: 'p2', _uuid: 'u2', versionId: '1' });
            const requestInfo = createMockFhirRequestInfo();

            await manager.insertOneAsync({ doc, requestInfo });

            expect(manager._mockPreSaveManager.preSaveAsync).toHaveBeenCalledTimes(1);
            expect(manager._mockPreSaveManager.preSaveAsync).toHaveBeenCalledWith(
                expect.objectContaining({ resource: doc })
            );
        });

        test('sets versionId to 1 if versionId is missing', async () => {
            const doc = createMockResource({ id: 'p3', _uuid: 'u3' });
            doc.meta.versionId = undefined;
            const requestInfo = createMockFhirRequestInfo();

            const result = await manager.insertOneAsync({ doc, requestInfo });

            expect(result.meta.versionId).toBe('1');
        });

        test('sets versionId to 1 if versionId is not a number', async () => {
            const doc = createMockResource({ id: 'p4', _uuid: 'u4' });
            doc.meta.versionId = 'abc';
            const requestInfo = createMockFhirRequestInfo();

            const result = await manager.insertOneAsync({ doc, requestInfo });

            expect(result.meta.versionId).toBe('1');
        });

        test('keeps valid numeric versionId unchanged', async () => {
            const doc = createMockResource({ id: 'p5', _uuid: 'u5', versionId: '5' });
            const requestInfo = createMockFhirRequestInfo();

            const result = await manager.insertOneAsync({ doc, requestInfo });

            expect(result.meta.versionId).toBe('5');
        });

        test('throws RethrownError on collection failure', async () => {
            const doc = createMockResource({ id: 'p6', _uuid: 'u6', versionId: '1' });
            const requestInfo = createMockFhirRequestInfo();
            manager._mockCollection.insertOne.mockRejectedValue(new Error('DB insert failed'));

            await expect(manager.insertOneAsync({ doc, requestInfo }))
                .rejects.toThrow(RethrownError);
        });

        test('gets the correct collection for the resource', async () => {
            const doc = createMockResource({ id: 'p7', _uuid: 'u7', versionId: '1' });
            const requestInfo = createMockFhirRequestInfo();

            await manager.insertOneAsync({ doc, requestInfo });

            expect(manager._mockResourceLocator.getCollectionForResourceAsync)
                .toHaveBeenCalledWith(doc);
        });
    });

    describe('updateOneAsync', () => {
        test('updates a document in the database', async () => {
            const doc = createMockResource({ id: 'p1', _uuid: 'u1', versionId: '2' });
            const requestInfo = createMockFhirRequestInfo();

            await manager.updateOneAsync({ doc, requestInfo });

            expect(manager._mockCollection.replaceOne).toHaveBeenCalledTimes(1);
            expect(manager._mockCollection.replaceOne).toHaveBeenCalledWith(
                { _uuid: doc._uuid },
                doc.toJSONInternal()
            );
        });

        test('calls preSaveManager before updating', async () => {
            const doc = createMockResource({ id: 'p2', _uuid: 'u2', versionId: '3' });
            const requestInfo = createMockFhirRequestInfo();

            await manager.updateOneAsync({ doc, requestInfo });

            expect(manager._mockPreSaveManager.preSaveAsync).toHaveBeenCalledTimes(1);
        });

        test('throws RethrownError on collection failure', async () => {
            const doc = createMockResource({ id: 'p3', _uuid: 'u3', versionId: '1' });
            const requestInfo = createMockFhirRequestInfo();
            manager._mockCollection.replaceOne.mockRejectedValue(new Error('DB update failed'));

            await expect(manager.updateOneAsync({ doc, requestInfo }))
                .rejects.toThrow(RethrownError);
        });

        test('throws AssertionError if doc is not a Resource instance', async () => {
            const requestInfo = createMockFhirRequestInfo();

            await expect(manager.updateOneAsync({ doc: { id: 'fake' }, requestInfo }))
                .rejects.toThrow();
        });
    });

    describe('replaceOneAsync', () => {
        test('inserts when no existing resource found in database', async () => {
            const requestInfo = createMockFhirRequestInfo();
            const doc = createMockResource({ id: 'p1', _uuid: 'u1', versionId: '1' });
            manager._mockDatabaseQueryManager.findOneAsync.mockResolvedValue(null);

            const result = await manager.replaceOneAsync({
                base_version: '4_0_0',
                requestInfo,
                doc
            });

            expect(result.savedResource).toBeTruthy();
            expect(result.patches).toBeNull();
            expect(manager._mockCollection.insertOne).toHaveBeenCalledTimes(1);
        });

        test('returns null savedResource when merge finds no changes', async () => {
            const requestInfo = createMockFhirRequestInfo();
            const doc = createMockResource({ id: 'p1', _uuid: 'u1', versionId: '1' });
            const existingDoc = createMockResource({ id: 'p1', _uuid: 'u1', versionId: '1' });

            manager._mockDatabaseQueryManager.findOneAsync.mockResolvedValue(existingDoc);
            manager._mockResourceMerger.mergeResourceAsync.mockResolvedValue({
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

        test('performs replaceOne when merge produces an updated resource', async () => {
            const requestInfo = createMockFhirRequestInfo();
            const doc = createMockResource({ id: 'p1', _uuid: 'u1', versionId: '1' });
            const existingDoc = createMockResource({ id: 'p1', _uuid: 'u1', versionId: '1' });
            const updatedDoc = createMockResource({ id: 'p1', _uuid: 'u1', versionId: '2' });

            manager._mockDatabaseQueryManager.findOneAsync.mockResolvedValue(existingDoc);
            manager._mockResourceMerger.mergeResourceAsync.mockResolvedValue({
                updatedResource: updatedDoc,
                patches: [{ op: 'replace', path: '/name', value: 'new' }]
            });
            manager._mockBase64DataManager.resolveWriteForExternalizedDataChange.mockResolvedValue(updatedDoc);

            const result = await manager.replaceOneAsync({
                base_version: '4_0_0',
                requestInfo,
                doc
            });

            expect(result.savedResource).toBeTruthy();
            expect(result.patches).toEqual([{ op: 'replace', path: '/name', value: 'new' }]);
            expect(manager._mockCollection.replaceOne).toHaveBeenCalled();
        });

        test('retries on concurrent update (matchedCount === 0)', async () => {
            const requestInfo = createMockFhirRequestInfo();
            const doc = createMockResource({ id: 'p1', _uuid: 'u1', versionId: '1' });
            const existingDoc = createMockResource({ id: 'p1', _uuid: 'u1', versionId: '1' });
            const updatedDoc = createMockResource({ id: 'p1', _uuid: 'u1', versionId: '2' });

            manager._mockDatabaseQueryManager.findOneAsync
                .mockResolvedValueOnce(existingDoc) // initial read
                .mockResolvedValueOnce(existingDoc); // retry read

            manager._mockResourceMerger.mergeResourceAsync.mockResolvedValue({
                updatedResource: updatedDoc,
                patches: [{ op: 'add', path: '/x', value: 1 }]
            });
            manager._mockBase64DataManager.resolveWriteForExternalizedDataChange.mockResolvedValue(updatedDoc);

            // First attempt fails (concurrent), second succeeds
            manager._mockCollection.replaceOne
                .mockResolvedValueOnce({ matchedCount: 0, modifiedCount: 0 })
                .mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 1 });

            const result = await manager.replaceOneAsync({
                base_version: '4_0_0',
                requestInfo,
                doc
            });

            expect(result.savedResource).toBeTruthy();
            expect(manager._mockCollection.replaceOne).toHaveBeenCalledTimes(2);
        });

        test('throws error when resource disappears during retry', async () => {
            const requestInfo = createMockFhirRequestInfo();
            const doc = createMockResource({ id: 'p1', _uuid: 'u1', versionId: '1' });
            const existingDoc = createMockResource({ id: 'p1', _uuid: 'u1', versionId: '1' });
            const updatedDoc = createMockResource({ id: 'p1', _uuid: 'u1', versionId: '2' });

            manager._mockDatabaseQueryManager.findOneAsync
                .mockResolvedValueOnce(existingDoc) // initial read
                .mockResolvedValueOnce(null); // retry read - resource gone

            manager._mockResourceMerger.mergeResourceAsync.mockResolvedValue({
                updatedResource: updatedDoc,
                patches: [{ op: 'add', path: '/x', value: 1 }]
            });
            manager._mockBase64DataManager.resolveWriteForExternalizedDataChange.mockResolvedValue(updatedDoc);

            manager._mockCollection.replaceOne
                .mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });

            await expect(manager.replaceOneAsync({
                base_version: '4_0_0',
                requestInfo,
                doc
            })).rejects.toThrow(RethrownError);
        });

        test('throws error after exhausting all retries', async () => {
            const requestInfo = createMockFhirRequestInfo();
            const doc = createMockResource({ id: 'p1', _uuid: 'u1', versionId: '1' });
            const existingDoc = createMockResource({ id: 'p1', _uuid: 'u1', versionId: '1' });
            const updatedDoc = createMockResource({ id: 'p1', _uuid: 'u1', versionId: '2' });

            manager._mockDatabaseQueryManager.findOneAsync.mockResolvedValue(existingDoc);
            manager._mockResourceMerger.mergeResourceAsync.mockResolvedValue({
                updatedResource: updatedDoc,
                patches: [{ op: 'add', path: '/x', value: 1 }]
            });
            manager._mockBase64DataManager.resolveWriteForExternalizedDataChange.mockResolvedValue(updatedDoc);

            // Always fail with matchedCount 0
            manager._mockCollection.replaceOne
                .mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });

            await expect(manager.replaceOneAsync({
                base_version: '4_0_0',
                requestInfo,
                doc
            })).rejects.toThrow(RethrownError);
        });

        test('calls deleteOwnUploadedLiveObjectsAsync on error', async () => {
            const requestInfo = createMockFhirRequestInfo();
            const doc = createMockResource({ id: 'p1', _uuid: 'u1', versionId: '1' });

            manager._mockDatabaseQueryManager.findOneAsync.mockRejectedValue(new Error('DB error'));

            await expect(manager.replaceOneAsync({
                base_version: '4_0_0',
                requestInfo,
                doc
            })).rejects.toThrow(RethrownError);

            expect(manager._mockBase64DataManager.deleteOwnUploadedLiveObjectsAsync).toHaveBeenCalled();
        });

        test('calls deleteSupersededLiveObjectsAsync on successful save', async () => {
            const requestInfo = createMockFhirRequestInfo();
            const doc = createMockResource({ id: 'p1', _uuid: 'u1', versionId: '1' });
            const existingDoc = createMockResource({ id: 'p1', _uuid: 'u1', versionId: '1' });
            const updatedDoc = createMockResource({ id: 'p1', _uuid: 'u1', versionId: '2' });

            manager._mockDatabaseQueryManager.findOneAsync.mockResolvedValue(existingDoc);
            manager._mockResourceMerger.mergeResourceAsync.mockResolvedValue({
                updatedResource: updatedDoc,
                patches: []
            });
            manager._mockBase64DataManager.resolveWriteForExternalizedDataChange.mockResolvedValue(updatedDoc);
            manager._mockCollection.replaceOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });

            await manager.replaceOneAsync({
                base_version: '4_0_0',
                requestInfo,
                doc
            });

            expect(manager._mockBase64DataManager.deleteSupersededLiveObjectsAsync).toHaveBeenCalled();
        });

        test('uses smartMerge parameter', async () => {
            const requestInfo = createMockFhirRequestInfo();
            const doc = createMockResource({ id: 'p1', _uuid: 'u1', versionId: '1' });
            const existingDoc = createMockResource({ id: 'p1', _uuid: 'u1', versionId: '1' });

            manager._mockDatabaseQueryManager.findOneAsync.mockResolvedValue(existingDoc);
            manager._mockResourceMerger.mergeResourceAsync.mockResolvedValue({
                updatedResource: null,
                patches: null
            });
            manager._mockBase64DataManager.resolveWriteForExternalizedDataChange.mockResolvedValue(null);

            await manager.replaceOneAsync({
                base_version: '4_0_0',
                requestInfo,
                doc,
                smartMerge: false
            });

            expect(manager._mockResourceMerger.mergeResourceAsync).toHaveBeenCalledWith(
                expect.objectContaining({ smartMerge: false })
            );
        });
    });

    describe('postSaveAsync', () => {
        test('inserts history entry for a resource', async () => {
            const requestInfo = createMockFhirRequestInfo({ requestId: 'req-123', method: 'POST' });
            const doc = createMockResource({ id: 'p1', _uuid: 'u1', versionId: '1' });

            await manager.postSaveAsync({ requestInfo, doc });

            expect(manager._mockResourceLocator.getHistoryCollectionNameForResource).toHaveBeenCalledWith(doc);
            expect(manager._mockResourceLocator.getCollectionByNameAsync).toHaveBeenCalledWith('Patient_4_0_0_History');
            expect(manager._mockCollection.insertOne).toHaveBeenCalledTimes(1);
        });

        test('calls preSaveManager before saving history', async () => {
            const requestInfo = createMockFhirRequestInfo();
            const doc = createMockResource({ id: 'p2', _uuid: 'u2', versionId: '1' });

            await manager.postSaveAsync({ requestInfo, doc });

            expect(manager._mockPreSaveManager.preSaveAsync).toHaveBeenCalledTimes(1);
        });

        test('throws assertion error if requestInfo is not FhirRequestInfo', async () => {
            const doc = createMockResource({ id: 'p3', _uuid: 'u3', versionId: '1' });

            await expect(manager.postSaveAsync({ requestInfo: {}, doc }))
                .rejects.toThrow();
        });

        test('throws assertion error if doc is not a Resource', async () => {
            const requestInfo = createMockFhirRequestInfo();

            await expect(manager.postSaveAsync({ requestInfo, doc: { id: 'fake' } }))
                .rejects.toThrow();
        });
    });
});
