'use strict';

const { describe, test, beforeEach, expect, jest: jestGlobal } = require('@jest/globals');
const { DatabaseBulkInserter } = require('../../../dataLayer/databaseBulkInserter');
const { RequestSpecificCache } = require('../../../utils/requestSpecificCache');

function createPrototypedMock(RealClass) {
    const mock = Object.create(RealClass.prototype);
    return mock;
}

const { PostRequestProcessor } = require('../../../utils/postRequestProcessor');
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
    const postRequestProcessor = createPrototypedMock(PostRequestProcessor);
    postRequestProcessor.add = jestGlobal.fn();
    const requestSpecificCache = overrides.requestSpecificCache || new RequestSpecificCache();
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
        postRequestProcessor,
        requestSpecificCache,
        base64DataManager,
        bulkWriteExecutors: overrides.bulkWriteExecutors || [mockExecutor]
    });
    inst._mockExecutor = mockExecutor;
    return inst;
}

function queueInsert(inserter, requestInfo, resourceType, doc) {
    const operationsByResourceType = inserter.getOperationsByResourceTypeMap({ requestId: requestInfo.requestId });
    if (!operationsByResourceType.has(resourceType)) {
        operationsByResourceType.set(resourceType, []);
    }
    operationsByResourceType.get(resourceType).push(
        inserter.getOperationForResourceAsync({
            requestId: requestInfo.requestId,
            resourceType,
            doc,
            operationType: 'insert',
            operation: { insertOne: { document: doc } },
            patches: null
        })
    );
}

describe('DatabaseBulkInserter', () => {
    let inserter;
    let requestSpecificCache;

    beforeEach(() => {
        requestSpecificCache = new RequestSpecificCache();
        inserter = createDatabaseBulkInserter({ requestSpecificCache });
    });

    describe('insertOneHistoryAsync _recorded', () => {
        test('stamps _recorded as a Date at creation with millisecond precision', async () => {
            const doc = createMockResource();
            const requestInfo = createMockFhirRequestInfo();
            const before = Date.now();
            await inserter.insertOneHistoryAsync({ base_version: '4_0_0', requestInfo, resourceType: 'Patient', doc });
            const after = Date.now();
            const entry = inserter.getHistoryOperationsByResourceTypeMap({ requestId: requestInfo.requestId }).get('Patient')[0];
            const { _recorded } = entry.operation.insertOne.document;
            expect(_recorded).toBeInstanceOf(Date);
            expect(_recorded.getTime()).toBeGreaterThanOrEqual(before);
            expect(_recorded.getTime()).toBeLessThanOrEqual(after);
            expect(_recorded.toISOString()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        });

        test('_recorded is fixed at creation and not changed by later reads of the operation', async () => {
            const doc = createMockResource();
            const requestInfo = createMockFhirRequestInfo();
            await inserter.insertOneHistoryAsync({ base_version: '4_0_0', requestInfo, resourceType: 'Patient', doc });
            const map = () => inserter.getHistoryOperationsByResourceTypeMap({ requestId: requestInfo.requestId });
            const first = map().get('Patient')[0].operation.insertOne.document._recorded.getTime();
            await new Promise((resolve) => setTimeout(resolve, 5));
            expect(map().get('Patient')[0].operation.insertOne.document._recorded.getTime()).toBe(first);
        });
    });

    describe('executeAsync', () => {
        test('delegates to executor', async () => {
            const requestInfo = createMockFhirRequestInfo();
            queueInsert(inserter, requestInfo, 'Patient', createMockResource({ id: 'pe', _uuid: 'ue' }));
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
            queueInsert(inserter, requestInfo, 'Patient', createMockResource({ id: 'px', _uuid: 'ux' }));
            await inserter.executeAsync({ requestInfo, base_version: '4_0_0' });
            expect(inserter.getOperationsByResourceTypeMap({ requestId: requestInfo.requestId }).size).toBe(0);
        });
    });

    describe('boundary: 0, 1, >1 operations', () => {
        test('>1 resource types processes all', async () => {
            const requestInfo = createMockFhirRequestInfo();
            queueInsert(inserter, requestInfo, 'Patient', createMockResource({ id: 'p1', _uuid: 'u1' }));
            queueInsert(inserter, requestInfo, 'Observation', createMockResource({ id: 'o1', _uuid: 'u2', resourceType: 'Observation' }));
            const results = await inserter.executeAsync({ requestInfo, base_version: '4_0_0' });
            expect(results.length).toBe(2);
        });
    });
});
