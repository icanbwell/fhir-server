'use strict';

const { describe, test, beforeEach, expect, jest: jestGlobal } = require('@jest/globals');
const { MongoBulkWriteExecutor, isDocumentSizeError } = require('../../../../dataLayer/bulkWriteExecutors/mongoBulkWriteExecutor');
const { BulkInsertUpdateEntry } = require('../../../../dataLayer/bulkInsertUpdateEntry');
const { MongoInvalidArgumentError } = require('mongodb');
const { MONGO_ERROR } = require('../../../../constants');

function createPrototypedMock(RealClass) {
    return Object.create(RealClass.prototype);
}

function defineGetter(obj, prop, value) {
    Object.defineProperty(obj, prop, { get: () => value, configurable: true });
}

const { ResourceLocatorFactory } = require('../../../../operations/common/resourceLocatorFactory');
const { ConfigManager } = require('../../../../utils/configManager');
const { PostSaveProcessor } = require('../../../../dataLayer/postSaveProcessor');
const { PostRequestProcessor } = require('../../../../utils/postRequestProcessor');
const { Base64DataManager } = require('../../../../dataLayer/base64DataManager');
const { FhirRequestInfo } = require('../../../../utils/fhirRequestInfo');

function createMockFhirRequestInfo() {
    const info = createPrototypedMock(FhirRequestInfo);
    info.requestId = 'test-req';
    info.userRequestId = 'user-req';
    info.method = 'POST';
    info.headers = {};
    return info;
}

function createMockCollection() {
    return {
        bulkWrite: jestGlobal.fn().mockResolvedValue({
            upsertedCount: 1,
            modifiedCount: 0,
            hasWriteErrors: () => false,
            getWriteErrors: () => []
        })
    };
}

function createExecutor(overrides = {}) {
    const resourceLocatorFactory = createPrototypedMock(ResourceLocatorFactory);
    const mockCollection = overrides.collection || createMockCollection();
    resourceLocatorFactory.createResourceLocator = jestGlobal.fn().mockReturnValue({
        getCollectionNameForResource: jestGlobal.fn().mockReturnValue('Patient_4_0_0'),
        getHistoryCollectionNameForResource: jestGlobal.fn().mockReturnValue('Patient_4_0_0_History'),
        getCollectionByNameAsync: jestGlobal.fn().mockResolvedValue(mockCollection),
        getAccessLogCollectionAsync: jestGlobal.fn().mockResolvedValue(mockCollection)
    });

    const configManager = createPrototypedMock(ConfigManager);
    defineGetter(configManager, 'handleConcurrency', overrides.handleConcurrency !== undefined ? overrides.handleConcurrency : false);

    const postSaveProcessor = createPrototypedMock(PostSaveProcessor);
    postSaveProcessor.afterSaveAsync = jestGlobal.fn().mockResolvedValue(undefined);
    postSaveProcessor.needsSyncFor = jestGlobal.fn().mockReturnValue(false);

    const postRequestProcessor = createPrototypedMock(PostRequestProcessor);
    postRequestProcessor.add = jestGlobal.fn();

    const base64DataManager = createPrototypedMock(Base64DataManager);
    base64DataManager.cleanupPreviousLiveObjectAsync = jestGlobal.fn().mockResolvedValue(undefined);

    const cloneResource = jestGlobal.fn().mockImplementation(r => ({ ...r }));
    const createUpdateManager = jestGlobal.fn().mockReturnValue({
        replaceOneAsync: jestGlobal.fn().mockResolvedValue({ savedResource: null, patches: null })
    });

    return new MongoBulkWriteExecutor({
        resourceLocatorFactory,
        configManager,
        postSaveProcessor,
        postRequestProcessor,
        cloneResource,
        createUpdateManager,
        base64DataManager
    });
}

function createBulkEntry(overrides = {}) {
    return new BulkInsertUpdateEntry({
        id: overrides.id || 'res-1',
        uuid: overrides.uuid || 'uuid-1',
        sourceAssigningAuthority: overrides.sourceAssigningAuthority || 'auth1',
        resourceType: overrides.resourceType || 'Patient',
        resource: overrides.resource || { resourceType: 'Patient', id: 'res-1', _uuid: 'uuid-1' },
        operation: overrides.operation || { updateOne: { filter: { _uuid: 'uuid-1' }, update: { $setOnInsert: {} }, upsert: true } },
        operationType: overrides.operationType || 'insertUniqueId',
        patches: overrides.patches || null,
        isCreateOperation: overrides.isCreateOperation !== undefined ? overrides.isCreateOperation : true,
        isUpdateOperation: overrides.isUpdateOperation !== undefined ? overrides.isUpdateOperation : false,
        contextData: overrides.contextData || null
    });
}

describe('MongoBulkWriteExecutor', () => {
    let executor;

    beforeEach(() => {
        executor = createExecutor();
    });

    describe('canHandle', () => {
        test('returns true for any resourceType', () => {
            expect(executor.canHandle('Patient')).toBe(true);
            expect(executor.canHandle('Observation')).toBe(true);
            expect(executor.canHandle('AnyResource')).toBe(true);
        });
    });

    describe('executeBulkAsync (largest method #1)', () => {
        test('executes bulk write and returns merge result entries', async () => {
            const requestInfo = createMockFhirRequestInfo();
            const entry = createBulkEntry();
            const insertOneHistoryFn = jestGlobal.fn().mockResolvedValue(undefined);

            const result = await executor.executeBulkAsync({
                resourceType: 'Patient',
                base_version: '4_0_0',
                useHistoryCollection: false,
                operations: [entry],
                requestInfo,
                maintainOrder: true,
                isAccessLogOperation: false,
                insertOneHistoryFn
            });

            expect(result.resourceType).toBe('Patient');
            expect(result.mergeResultEntries.length).toBe(1);
            expect(result.mergeResultEntries[0].created).toBe(true);
            expect(insertOneHistoryFn).toHaveBeenCalled();
        });

        test('skips history insert for AuditEvent', async () => {
            const requestInfo = createMockFhirRequestInfo();
            const entry = createBulkEntry({ resourceType: 'AuditEvent', resource: { resourceType: 'AuditEvent', id: 'ae', _uuid: 'u-ae' } });
            const insertOneHistoryFn = jestGlobal.fn();

            await executor.executeBulkAsync({
                resourceType: 'AuditEvent',
                base_version: '4_0_0',
                useHistoryCollection: false,
                operations: [entry],
                requestInfo,
                insertOneHistoryFn
            });

            expect(insertOneHistoryFn).not.toHaveBeenCalled();
        });

        test('skips history insert for history collection operations', async () => {
            const requestInfo = createMockFhirRequestInfo();
            const entry = createBulkEntry();
            const insertOneHistoryFn = jestGlobal.fn();

            await executor.executeBulkAsync({
                resourceType: 'Patient',
                base_version: '4_0_0',
                useHistoryCollection: true,
                operations: [entry],
                requestInfo,
                insertOneHistoryFn
            });

            expect(insertOneHistoryFn).not.toHaveBeenCalled();
        });

        test('handles bulk write error gracefully for document size errors', async () => {
            const errCollection = createMockCollection();
            const sizeError = new MongoInvalidArgumentError(MONGO_ERROR.RESOURCE_SIZE_EXCEEDS);
            errCollection.bulkWrite.mockRejectedValue(sizeError);
            const exec = createExecutor({ collection: errCollection });

            const requestInfo = createMockFhirRequestInfo();
            const entry = createBulkEntry();
            const insertOneHistoryFn = jestGlobal.fn();

            const result = await exec.executeBulkAsync({
                resourceType: 'Patient',
                base_version: '4_0_0',
                useHistoryCollection: false,
                operations: [entry],
                requestInfo,
                insertOneHistoryFn
            });

            expect(result.mergeResultEntries[0].issue).toBeDefined();
            expect(result.mergeResultEntries[0].issue.severity).toBe('error');
        });

        test('throws for non-document-size errors', async () => {
            const errCollection = createMockCollection();
            errCollection.bulkWrite.mockRejectedValue(new Error('Connection lost'));
            const exec = createExecutor({ collection: errCollection });

            const requestInfo = createMockFhirRequestInfo();
            const entry = createBulkEntry();

            await expect(exec.executeBulkAsync({
                resourceType: 'Patient',
                base_version: '4_0_0',
                useHistoryCollection: false,
                operations: [entry],
                requestInfo,
                insertOneHistoryFn: jestGlobal.fn()
            })).rejects.toThrow();
        });

        test('fires postSave event for create operations', async () => {
            const requestInfo = createMockFhirRequestInfo();
            const entry = createBulkEntry();
            const insertOneHistoryFn = jestGlobal.fn().mockResolvedValue(undefined);

            await executor.executeBulkAsync({
                resourceType: 'Patient',
                base_version: '4_0_0',
                useHistoryCollection: false,
                operations: [entry],
                requestInfo,
                insertOneHistoryFn
            });

            expect(executor.postRequestProcessor.add).toHaveBeenCalled();
        });

        test('boundary: 0 operations returns empty merge results', async () => {
            const requestInfo = createMockFhirRequestInfo();
            const result = await executor.executeBulkAsync({
                resourceType: 'Patient',
                base_version: '4_0_0',
                useHistoryCollection: false,
                operations: [],
                requestInfo,
                insertOneHistoryFn: jestGlobal.fn()
            });
            expect(result.mergeResultEntries).toEqual([]);
        });

        test('boundary: >1 operations processes all', async () => {
            const requestInfo = createMockFhirRequestInfo();
            const collection = createMockCollection();
            collection.bulkWrite.mockResolvedValue({ upsertedCount: 2, modifiedCount: 0, hasWriteErrors: () => false, getWriteErrors: () => [] });
            const exec = createExecutor({ collection });

            const entries = [
                createBulkEntry({ id: 'r1', uuid: 'u1' }),
                createBulkEntry({ id: 'r2', uuid: 'u2' })
            ];
            const insertOneHistoryFn = jestGlobal.fn().mockResolvedValue(undefined);

            const result = await exec.executeBulkAsync({
                resourceType: 'Patient',
                base_version: '4_0_0',
                useHistoryCollection: false,
                operations: entries,
                requestInfo,
                insertOneHistoryFn
            });
            expect(result.mergeResultEntries.length).toBe(2);
        });
    });

    describe('concurrency handling', () => {
        test('falls back to one-by-one when upsertedCount < expected', async () => {
            const collection = createMockCollection();
            collection.bulkWrite.mockResolvedValue({
                upsertedCount: 0, // less than expected 1
                modifiedCount: 0,
                hasWriteErrors: () => false,
                getWriteErrors: () => []
            });
            const exec = createExecutor({ collection, handleConcurrency: true });

            const requestInfo = createMockFhirRequestInfo();
            const entry = createBulkEntry();
            const insertOneHistoryFn = jestGlobal.fn().mockResolvedValue(undefined);

            await exec.executeBulkAsync({
                resourceType: 'Patient',
                base_version: '4_0_0',
                useHistoryCollection: false,
                operations: [entry],
                requestInfo,
                insertOneHistoryFn
            });

            expect(exec.createUpdateManager).toHaveBeenCalled();
        });
    });

    describe('isDocumentSizeError', () => {
        test('recognizes MongoInvalidArgumentError with specific message', () => {
            const err = new MongoInvalidArgumentError(MONGO_ERROR.RESOURCE_SIZE_EXCEEDS);
            expect(isDocumentSizeError(err)).toBe(true);
        });

        test('recognizes error code 10334', () => {
            expect(isDocumentSizeError({ code: 10334 })).toBe(true);
        });

        test('recognizes error code 17419', () => {
            expect(isDocumentSizeError({ code: 17419 })).toBe(true);
        });

        test('recognizes ERR_OUT_OF_RANGE with boundary number', () => {
            expect(isDocumentSizeError({ code: 'ERR_OUT_OF_RANGE', message: 'value out of range 17825792' })).toBe(true);
        });

        test('recognizes writeErrors with size error code', () => {
            expect(isDocumentSizeError({ writeErrors: [{ code: 10334 }] })).toBe(true);
        });

        test('returns false for null', () => {
            expect(isDocumentSizeError(null)).toBe(false);
        });

        test('returns false for generic error', () => {
            expect(isDocumentSizeError(new Error('generic'))).toBe(false);
        });
    });
});
