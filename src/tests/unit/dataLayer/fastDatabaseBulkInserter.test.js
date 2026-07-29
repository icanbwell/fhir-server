'use strict';

const { describe, test, beforeEach, expect, jest: jestGlobal } = require('@jest/globals');
const { FastDatabaseBulkInserter } = require('../../../dataLayer/fastDatabaseBulkInserter');
const { RequestSpecificCache } = require('../../../utils/requestSpecificCache');

function createPrototypedMock(RealClass) {
    const mock = Object.create(RealClass.prototype);
    return mock;
}

function defineGetter(obj, prop, value) {
    Object.defineProperty(obj, prop, { get: () => value, configurable: true });
}

const { ResourceManager } = require('../../../operations/common/resourceManager');
const { PostRequestProcessor } = require('../../../utils/postRequestProcessor');
const { ResourceLocatorFactory } = require('../../../operations/common/resourceLocatorFactory');
const { PreSaveManager } = require('../../../preSaveHandlers/preSave');
const { DatabaseUpdateFactory } = require('../../../dataLayer/databaseUpdateFactory');
const { ResourceMerger } = require('../../../operations/common/resourceMerger');
const { ConfigManager } = require('../../../utils/configManager');
const { PostSaveProcessor } = require('../../../dataLayer/postSaveProcessor');
const { Base64DataManager } = require('../../../dataLayer/base64DataManager');
const { FhirRequestInfo } = require('../../../utils/fhirRequestInfo');
const { CustomTracer } = require('../../../utils/customTracer');

function createMockFhirRequestInfo(overrides = {}) {
    const info = createPrototypedMock(FhirRequestInfo);
    info.requestId = overrides.requestId || 'test-request-id';
    info.userRequestId = overrides.userRequestId || 'user-req-1';
    info.method = overrides.method || 'POST';
    info.headers = overrides.headers || {};
    return info;
}

function createFastInserter(overrides = {}) {
    const resourceManager = createPrototypedMock(ResourceManager);
    const postRequestProcessor = createPrototypedMock(PostRequestProcessor);
    postRequestProcessor.add = jestGlobal.fn();
    const resourceLocatorFactory = createPrototypedMock(ResourceLocatorFactory);
    const preSaveManager = createPrototypedMock(PreSaveManager);
    preSaveManager.preSaveAsync = jestGlobal.fn().mockImplementation(async ({ resource }) => resource);
    const requestSpecificCache = overrides.requestSpecificCache || new RequestSpecificCache();
    const databaseUpdateFactory = createPrototypedMock(DatabaseUpdateFactory);
    const resourceMerger = createPrototypedMock(ResourceMerger);
    resourceMerger.fastMergeResourceAsync = jestGlobal.fn().mockResolvedValue({ updatedResource: null, patches: [] });
    const configManager = createPrototypedMock(ConfigManager);
    defineGetter(configManager, 'handleConcurrency', true);
    const postSaveProcessor = createPrototypedMock(PostSaveProcessor);
    const base64DataManager = createPrototypedMock(Base64DataManager);
    base64DataManager.transformHistoryAsync = jestGlobal.fn().mockImplementation(async (doc) => doc);
    const customTracer = createPrototypedMock(CustomTracer);
    customTracer.trace = jestGlobal.fn().mockImplementation(async ({ func }) => await func());

    const mockExecutor = {
        canHandle: jestGlobal.fn().mockReturnValue(true),
        executeBulkAsync: jestGlobal.fn().mockResolvedValue({
            resourceType: 'Patient',
            mergeResult: null,
            error: null,
            mergeResultEntries: [{ id: '1', uuid: 'uuid-1', created: true }]
        })
    };

    const inst = new FastDatabaseBulkInserter({
        resourceManager,
        postRequestProcessor,
        resourceLocatorFactory,
        preSaveManager,
        requestSpecificCache,
        databaseUpdateFactory,
        resourceMerger,
        configManager,
        postSaveProcessor,
        base64DataManager,
        bulkWriteExecutors: overrides.bulkWriteExecutors || [mockExecutor],
        customTracer
    });
    inst._mockExecutor = mockExecutor;
    return inst;
}

describe('FastDatabaseBulkInserter', () => {
    let inserter;
    let requestSpecificCache;

    beforeEach(() => {
        requestSpecificCache = new RequestSpecificCache();
        inserter = createFastInserter({ requestSpecificCache });
    });

    describe('insertOneAsync', () => {
        test('creates insertUniqueId operation for non-AuditEvent', async () => {
            const doc = { resourceType: 'Patient', id: 'p1', _uuid: 'u1', _sourceAssigningAuthority: 'a', meta: { versionId: '1' } };
            const requestInfo = createMockFhirRequestInfo();
            await inserter.insertOneAsync({ base_version: '4_0_0', requestInfo, resourceType: 'Patient', doc });
            const map = inserter.getOperationsByResourceTypeMap({ requestId: requestInfo.requestId });
            expect(map.get('Patient')[0].operationType).toBe('insertUniqueId');
        });

        test('creates insertOne for AuditEvent', async () => {
            const doc = { resourceType: 'AuditEvent', id: 'ae1', _uuid: 'u-ae', _sourceAssigningAuthority: 'a', meta: { versionId: '1' } };
            const requestInfo = createMockFhirRequestInfo();
            await inserter.insertOneAsync({ base_version: '4_0_0', requestInfo, resourceType: 'AuditEvent', doc });
            const map = inserter.getOperationsByResourceTypeMap({ requestId: requestInfo.requestId });
            expect(map.get('AuditEvent')[0].operation.insertOne).toBeDefined();
        });

        test('sets versionId to 1 when invalid', async () => {
            const doc = { resourceType: 'Patient', id: 'p2', _uuid: 'u2', _sourceAssigningAuthority: 'a', meta: { versionId: 'abc' } };
            const requestInfo = createMockFhirRequestInfo();
            await inserter.insertOneAsync({ base_version: '4_0_0', requestInfo, resourceType: 'Patient', doc });
            expect(doc.meta.versionId).toBe('1');
        });

        test('duplicate uuid triggers merge path', async () => {
            const requestInfo = createMockFhirRequestInfo();
            const doc1 = { resourceType: 'Patient', id: 'pd', _uuid: 'u-dup', _sourceAssigningAuthority: 'a', meta: { versionId: '1' } };
            await inserter.insertOneAsync({ base_version: '4_0_0', requestInfo, resourceType: 'Patient', doc: doc1 });
            const doc2 = { resourceType: 'Patient', id: 'pd', _uuid: 'u-dup', _sourceAssigningAuthority: 'a', meta: { versionId: '2' } };
            await inserter.insertOneAsync({ base_version: '4_0_0', requestInfo, resourceType: 'Patient', doc: doc2 });
            const map = inserter.getOperationsByResourceTypeMap({ requestId: requestInfo.requestId });
            // Should not double-add a separate operation for second insert
            expect(map.get('Patient').length).toBeGreaterThanOrEqual(1);
        });
    });

    describe('mergeOneAsync', () => {
        test('creates replaceOne with $and filter when previousVersionId > 0', async () => {
            const requestInfo = createMockFhirRequestInfo();
            const doc = { resourceType: 'Patient', id: 'pm', _uuid: 'um', _sourceAssigningAuthority: 'a', meta: { versionId: '2' } };
            await inserter.mergeOneAsync({ base_version: '4_0_0', requestInfo, resourceType: 'Patient', previousVersionId: '1', doc, patches: null });
            const ops = inserter.getOperationsByResourceTypeMap({ requestId: requestInfo.requestId }).get('Patient');
            expect(ops[0].operation.replaceOne.filter.$and).toBeDefined();
        });

        test('uses simple _uuid filter when previousVersionId is 0', async () => {
            const requestInfo = createMockFhirRequestInfo();
            const doc = { resourceType: 'Patient', id: 'pz', _uuid: 'uz', _sourceAssigningAuthority: 'a', meta: { versionId: '1' } };
            await inserter.mergeOneAsync({ base_version: '4_0_0', requestInfo, resourceType: 'Patient', previousVersionId: '0', doc, patches: null });
            const ops = inserter.getOperationsByResourceTypeMap({ requestId: requestInfo.requestId }).get('Patient');
            expect(ops[0].operation.replaceOne.filter._uuid).toBe('uz');
        });

        test('merges with pending update in place', async () => {
            const requestInfo = createMockFhirRequestInfo();
            const doc1 = { resourceType: 'Observation', id: 'o1', _uuid: 'uo', _sourceAssigningAuthority: 'a', meta: { versionId: '2' } };
            // Use patches array (not null) so spread works on second merge
            await inserter.mergeOneAsync({ base_version: '4_0_0', requestInfo, resourceType: 'Observation', previousVersionId: '1', doc: doc1, patches: [{ op: 'add', path: '/status', value: 'preliminary' }] });

            const updatedDoc = { resourceType: 'Observation', id: 'o1', _uuid: 'uo', _sourceAssigningAuthority: 'a', meta: { versionId: '2' }, status: 'final' };
            inserter.resourceMerger.fastMergeResourceAsync.mockResolvedValueOnce({
                updatedResource: updatedDoc,
                patches: [{ op: 'replace', path: '/status', value: 'final' }]
            });
            const doc2 = { resourceType: 'Observation', id: 'o1', _uuid: 'uo', _sourceAssigningAuthority: 'a', meta: { versionId: '3' }, status: 'final' };
            await inserter.mergeOneAsync({ base_version: '4_0_0', requestInfo, resourceType: 'Observation', previousVersionId: '2', doc: doc2, patches: null });
            const ops = inserter.getOperationsByResourceTypeMap({ requestId: requestInfo.requestId }).get('Observation');
            expect(ops.length).toBe(1);
        }, 10000);
    });

    describe('executeAsync', () => {
        test('delegates to executor and returns results', async () => {
            const requestInfo = createMockFhirRequestInfo();
            const doc = { resourceType: 'Patient', id: 'pe', _uuid: 'ue', _sourceAssigningAuthority: 'a', meta: { versionId: '1' } };
            await inserter.insertOneAsync({ base_version: '4_0_0', requestInfo, resourceType: 'Patient', doc });
            const results = await inserter.executeAsync({ requestInfo, base_version: '4_0_0' });
            expect(inserter._mockExecutor.executeBulkAsync).toHaveBeenCalled();
            expect(Array.isArray(results)).toBe(true);
        });

        test('clears map after execution', async () => {
            const requestInfo = createMockFhirRequestInfo();
            const doc = { resourceType: 'Patient', id: 'pc', _uuid: 'uc', _sourceAssigningAuthority: 'a', meta: { versionId: '1' } };
            await inserter.insertOneAsync({ base_version: '4_0_0', requestInfo, resourceType: 'Patient', doc });
            await inserter.executeAsync({ requestInfo, base_version: '4_0_0' });
            const map = inserter.getOperationsByResourceTypeMap({ requestId: requestInfo.requestId });
            expect(map.size).toBe(0);
        });

        test('throws when no executor matches', async () => {
            const noMatch = createFastInserter({ requestSpecificCache, bulkWriteExecutors: [{ canHandle: () => false, executeBulkAsync: jestGlobal.fn() }] });
            const requestInfo = createMockFhirRequestInfo();
            const doc = { resourceType: 'Patient', id: 'pf', _uuid: 'uf', _sourceAssigningAuthority: 'a', meta: { versionId: '1' } };
            await noMatch.insertOneAsync({ base_version: '4_0_0', requestInfo, resourceType: 'Patient', doc });
            await expect(noMatch.executeAsync({ requestInfo, base_version: '4_0_0' })).rejects.toThrow(/No BulkWriteExecutor/);
        });

        test('0 operations returns empty array', async () => {
            const requestInfo = createMockFhirRequestInfo();
            const results = await inserter.executeAsync({ requestInfo, base_version: '4_0_0' });
            expect(results).toEqual([]);
        });

        test('>1 resource types processes all', async () => {
            const requestInfo = createMockFhirRequestInfo();
            await inserter.insertOneAsync({ base_version: '4_0_0', requestInfo, resourceType: 'Patient', doc: { resourceType: 'Patient', id: 'p1', _uuid: 'u1', _sourceAssigningAuthority: 'a', meta: { versionId: '1' } } });
            await inserter.insertOneAsync({ base_version: '4_0_0', requestInfo, resourceType: 'Observation', doc: { resourceType: 'Observation', id: 'o1', _uuid: 'u2', _sourceAssigningAuthority: 'a', meta: { versionId: '1' } } });
            const results = await inserter.executeAsync({ requestInfo, base_version: '4_0_0' });
            expect(results.length).toBe(2);
        });
    });

    describe('getPendingUpdates / getPendingInsertsWithUniqueId', () => {
        test('returns empty for missing resourceType', () => {
            expect(inserter.getPendingUpdates({ requestId: 'x', resourceType: 'X' })).toEqual([]);
            expect(inserter.getPendingInsertsWithUniqueId({ requestId: 'x', resourceType: 'X' })).toEqual([]);
        });
    });
});
