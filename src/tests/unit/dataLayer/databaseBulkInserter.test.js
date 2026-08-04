'use strict';

const { describe, test, beforeEach, expect, jest: jestGlobal } = require('@jest/globals');
const { DatabaseBulkInserter } = require('../../../dataLayer/databaseBulkInserter');
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
const Resource = require('../../../fhir/classes/4_0_0/resources/resource');

function createMockFhirRequestInfo(overrides = {}) {
    const info = createPrototypedMock(FhirRequestInfo);
    info.requestId = overrides.requestId || 'test-req-id';
    info.userRequestId = overrides.userRequestId || 'user-req-1';
    info.method = overrides.method || 'POST';
    info.headers = overrides.headers || {};
    return info;
}

function createMockResource(overrides = {}) {
    const resourceType = overrides.resourceType || 'Patient';
    // Use getResource to get proper typed class
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
        meta: { versionId: overrides.versionId || '1' }
    });
    r._uuid = overrides._uuid || 'uuid-res-1';
    r._sourceAssigningAuthority = overrides._sourceAssigningAuthority || 'auth1';
    return r;
}

function createDatabaseBulkInserter(overrides = {}) {
    const resourceManager = createPrototypedMock(ResourceManager);
    const postRequestProcessor = createPrototypedMock(PostRequestProcessor);
    postRequestProcessor.add = jestGlobal.fn();
    const resourceLocatorFactory = createPrototypedMock(ResourceLocatorFactory);
    const preSaveManager = createPrototypedMock(PreSaveManager);
    preSaveManager.preSaveAsync = jestGlobal.fn().mockImplementation(async ({ resource }) => resource);
    const requestSpecificCache = overrides.requestSpecificCache || new RequestSpecificCache();
    const databaseUpdateFactory = createPrototypedMock(DatabaseUpdateFactory);
    const resourceMerger = createPrototypedMock(ResourceMerger);
    resourceMerger.mergeResourceAsync = jestGlobal.fn().mockResolvedValue({ updatedResource: null, patches: [] });
    const configManager = createPrototypedMock(ConfigManager);
    defineGetter(configManager, 'handleConcurrency', true);
    const postSaveProcessor = createPrototypedMock(PostSaveProcessor);
    const base64DataManager = createPrototypedMock(Base64DataManager);
    base64DataManager.transformHistoryAsync = jestGlobal.fn().mockImplementation(async (doc) => doc);

    const mockExecutor = {
        canHandle: jestGlobal.fn().mockReturnValue(true),
        executeBulkAsync: jestGlobal.fn().mockResolvedValue({
            resourceType: 'Patient',
            mergeResult: null,
            error: null,
            mergeResultEntries: [{ id: '1', uuid: 'uuid-1', created: true }]
        })
    };

    const inst = new DatabaseBulkInserter({
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
        bulkWriteExecutors: overrides.bulkWriteExecutors || [mockExecutor]
    });
    inst._mockExecutor = mockExecutor;
    inst._resourceMerger = resourceMerger;
    return inst;
}

describe('DatabaseBulkInserter', () => {
    let inserter;
    let requestSpecificCache;

    beforeEach(() => {
        requestSpecificCache = new RequestSpecificCache();
        inserter = createDatabaseBulkInserter({ requestSpecificCache });
    });

    describe('insertOneAsync', () => {
        test('creates insertUniqueId updateOne for non-AuditEvent', async () => {
            const doc = createMockResource({ id: 'p1', _uuid: 'u1', resourceType: 'Patient' });
            const requestInfo = createMockFhirRequestInfo();
            await inserter.insertOneAsync({ base_version: '4_0_0', requestInfo, resourceType: 'Patient', doc });
            const map = inserter.getOperationsByResourceTypeMap({ requestId: requestInfo.requestId });
            const ops = map.get('Patient');
            expect(ops[0].operationType).toBe('insertUniqueId');
            expect(ops[0].operation.updateOne.filter._uuid).toBe('u1');
        });

        test('creates insertOne for AuditEvent', async () => {
            const doc = createMockResource({ id: 'ae1', _uuid: 'u-ae', resourceType: 'AuditEvent' });
            const requestInfo = createMockFhirRequestInfo();
            await inserter.insertOneAsync({ base_version: '4_0_0', requestInfo, resourceType: 'AuditEvent', doc });
            const map = inserter.getOperationsByResourceTypeMap({ requestId: requestInfo.requestId });
            expect(map.get('AuditEvent')[0].operation.insertOne).toBeDefined();
        });

        test('sets versionId to 1 when NaN', async () => {
            const doc = createMockResource({ id: 'p2', _uuid: 'u2', resourceType: 'Patient', versionId: 'bad' });
            const requestInfo = createMockFhirRequestInfo();
            await inserter.insertOneAsync({ base_version: '4_0_0', requestInfo, resourceType: 'Patient', doc });
            expect(doc.meta.versionId).toBe('1');
        });
    });

    describe('mergeOneAsync', () => {
        test('creates replaceOne with version filter', async () => {
            const requestInfo = createMockFhirRequestInfo();
            const doc = createMockResource({ id: 'pm', _uuid: 'um', resourceType: 'Patient', versionId: '2' });
            await inserter.mergeOneAsync({ base_version: '4_0_0', requestInfo, resourceType: 'Patient', previousVersionId: '1', doc, patches: null });
            const ops = inserter.getOperationsByResourceTypeMap({ requestId: requestInfo.requestId }).get('Patient');
            expect(ops[0].operation.replaceOne.filter.$and).toBeDefined();
            expect(ops[0].operation.replaceOne.filter.$and[1]['meta.versionId']).toBe('1');
        });

        test('uses _uuid only filter when previousVersionId is 0', async () => {
            const requestInfo = createMockFhirRequestInfo();
            const doc = createMockResource({ id: 'p0', _uuid: 'u0', resourceType: 'Patient', versionId: '1' });
            await inserter.mergeOneAsync({ base_version: '4_0_0', requestInfo, resourceType: 'Patient', previousVersionId: '0', doc, patches: null });
            const ops = inserter.getOperationsByResourceTypeMap({ requestId: requestInfo.requestId }).get('Patient');
            expect(ops[0].operation.replaceOne.filter._uuid).toBe('u0');
        });

        test('merges with pending update in place when first merge has null patches', async () => {
            const requestInfo = createMockFhirRequestInfo();
            const doc1 = createMockResource({ id: 'obs', _uuid: 'uo', resourceType: 'Observation', versionId: '2' });
            // EXPECTED: correct behavior (will fail until bug is fixed)
            // First merge with patches: null should not crash on second merge
            await inserter.mergeOneAsync({ base_version: '4_0_0', requestInfo, resourceType: 'Observation', previousVersionId: '1', doc: doc1, patches: null });

            inserter._resourceMerger.mergeResourceAsync.mockResolvedValueOnce({
                updatedResource: createMockResource({ id: 'obs', _uuid: 'uo', resourceType: 'Observation', versionId: '2' }),
                patches: [{ op: 'replace', path: '/status', value: 'final' }]
            });
            const doc2 = createMockResource({ id: 'obs', _uuid: 'uo', resourceType: 'Observation', versionId: '3' });
            // Should handle null patches gracefully (treat null as empty array), not throw TypeError
            await expect(
                inserter.mergeOneAsync({ base_version: '4_0_0', requestInfo, resourceType: 'Observation', previousVersionId: '2', doc: doc2, patches: null })
            ).resolves.not.toThrow();
            const ops = inserter.getOperationsByResourceTypeMap({ requestId: requestInfo.requestId }).get('Observation');
            expect(ops.length).toBe(1);
        }, 10000);
    });

    describe('replaceOneAsync', () => {
        test('creates replaceOne operation', async () => {
            const requestInfo = createMockFhirRequestInfo();
            const doc = createMockResource({ id: 'pr', _uuid: 'ur', resourceType: 'Patient', versionId: '2' });
            await inserter.replaceOneAsync({ requestInfo, resourceType: 'Patient', uuid: 'ur', doc, patches: null });
            const ops = inserter.getOperationsByResourceTypeMap({ requestId: requestInfo.requestId }).get('Patient');
            expect(ops[0].operationType).toBe('replace');
            expect(ops[0].operation.replaceOne.filter._uuid).toBe('ur');
        });

        test('replaces pending update in place', async () => {
            const requestInfo = createMockFhirRequestInfo();
            const doc1 = createMockResource({ id: 'pr2', _uuid: 'ur2', resourceType: 'Patient', versionId: '2' });
            await inserter.mergeOneAsync({ base_version: '4_0_0', requestInfo, resourceType: 'Patient', previousVersionId: '1', doc: doc1, patches: null });
            const doc2 = createMockResource({ id: 'pr2', _uuid: 'ur2', resourceType: 'Patient', versionId: '3' });
            await inserter.replaceOneAsync({ requestInfo, resourceType: 'Patient', uuid: 'ur2', doc: doc2, patches: null });
            const ops = inserter.getOperationsByResourceTypeMap({ requestId: requestInfo.requestId }).get('Patient');
            expect(ops.length).toBe(1);
        });
    });

    describe('executeAsync', () => {
        test('delegates to executor', async () => {
            const requestInfo = createMockFhirRequestInfo();
            const doc = createMockResource({ id: 'pe', _uuid: 'ue', resourceType: 'Patient' });
            await inserter.insertOneAsync({ base_version: '4_0_0', requestInfo, resourceType: 'Patient', doc });
            const results = await inserter.executeAsync({ requestInfo, base_version: '4_0_0' });
            expect(inserter._mockExecutor.executeBulkAsync).toHaveBeenCalled();
            expect(Array.isArray(results)).toBe(true);
        });

        test('0 operations returns empty', async () => {
            const requestInfo = createMockFhirRequestInfo();
            const results = await inserter.executeAsync({ requestInfo, base_version: '4_0_0' });
            expect(results).toEqual([]);
        });

        test('clears map after', async () => {
            const requestInfo = createMockFhirRequestInfo();
            const doc = createMockResource({ id: 'px', _uuid: 'ux', resourceType: 'Patient' });
            await inserter.insertOneAsync({ base_version: '4_0_0', requestInfo, resourceType: 'Patient', doc });
            await inserter.executeAsync({ requestInfo, base_version: '4_0_0' });
            expect(inserter.getOperationsByResourceTypeMap({ requestId: requestInfo.requestId }).size).toBe(0);
        });
    });

    describe('patchFieldAsync', () => {
        test('adds updateOne with $set operation', async () => {
            const resource = createMockResource({ id: 'pp', _uuid: 'up', resourceType: 'Patient' });
            await inserter.patchFieldAsync({ requestId: 'req-patch', resource, fieldName: 'active', fieldValue: true });
            const ops = inserter.getOperationsByResourceTypeMap({ requestId: 'req-patch' }).get('Patient');
            expect(ops[0].operation.updateOne.update.$set.active).toBe(true);
        });

        test('removes _id from resource before adding operation', async () => {
            const resource = createMockResource({ id: 'pp2', _uuid: 'up2', resourceType: 'Patient' });
            resource._id = 'should-be-removed';
            await inserter.patchFieldAsync({ requestId: 'req-patch2', resource, fieldName: 'active', fieldValue: false });
            expect(resource._id).toBeUndefined();
        });
    });

    describe('boundary: 0, 1, >1 operations', () => {
        test('>1 resource types processes all', async () => {
            const requestInfo = createMockFhirRequestInfo();
            await inserter.insertOneAsync({ base_version: '4_0_0', requestInfo, resourceType: 'Patient', doc: createMockResource({ id: 'p1', _uuid: 'u1' }) });
            await inserter.insertOneAsync({ base_version: '4_0_0', requestInfo, resourceType: 'Observation', doc: createMockResource({ id: 'o1', _uuid: 'u2', resourceType: 'Observation' }) });
            const results = await inserter.executeAsync({ requestInfo, base_version: '4_0_0' });
            expect(results.length).toBe(2);
        });
    });
});
