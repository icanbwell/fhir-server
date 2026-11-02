const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');
const { ReadPreference } = require('mongodb');
const { AdminResourceWriter } = require('../../../admin/adminResourceWriter');
const { DatabaseQueryFactory } = require('../../../dataLayer/databaseQueryFactory');
const { ResourceMerger } = require('../../../operations/common/resourceMerger');
const { FastDatabaseBulkInserter } = require('../../../dataLayer/fastDatabaseBulkInserter');
const { PostRequestProcessor } = require('../../../utils/postRequestProcessor');
const { RequestSpecificCache } = require('../../../utils/requestSpecificCache');
const { FhirRequestInfo } = require('../../../utils/fhirRequestInfo');
const BaseSerializer = require('../../../fhir/writeSerializers/4_0_0/customSerializers/baseSerializer');

const currentResource = {
    resourceType: 'Person',
    id: 'person-1',
    _uuid: 'person-uuid',
    meta: { versionId: '3' }
};

const mergedResource = {
    resourceType: 'Person',
    id: 'person-1',
    _uuid: 'person-uuid',
    meta: { versionId: '4' }
};

const patches = [{ op: 'remove', path: '/link/0' }];

function createWriter () {
    const callOrder = [];

    const queryManager = {
        fastFindOneAsync: jestObj.fn(async () => {
            callOrder.push('find');
            return currentResource;
        })
    };
    const databaseQueryFactory = Object.create(DatabaseQueryFactory.prototype);
    databaseQueryFactory.createQuery = jestObj.fn(() => queryManager);

    const resourceMerger = Object.create(ResourceMerger.prototype);
    resourceMerger.fastMergeResourceAsync = jestObj.fn(async () => {
        callOrder.push('merge');
        return { updatedResource: mergedResource, patches };
    });

    const fastDatabaseBulkInserter = Object.create(FastDatabaseBulkInserter.prototype);
    fastDatabaseBulkInserter.mergeOneAsync = jestObj.fn(async () => {
        callOrder.push('queueUpdate');
    });
    fastDatabaseBulkInserter.insertOneAsync = jestObj.fn(async () => {
        callOrder.push('queueInsert');
    });
    fastDatabaseBulkInserter.executeAsync = jestObj.fn(async () => {
        callOrder.push('execute');
        return [{ created: false, updated: true, resourceType: 'Person', uuid: 'person-uuid' }];
    });

    const postRequestProcessor = Object.create(PostRequestProcessor.prototype);
    postRequestProcessor.executeAsync = jestObj.fn(async () => {
        callOrder.push('drain');
    });

    const requestSpecificCache = Object.create(RequestSpecificCache.prototype);
    requestSpecificCache.clearAsync = jestObj.fn(async () => {
        callOrder.push('clear');
    });

    return {
        writer: new AdminResourceWriter({
            databaseQueryFactory,
            resourceMerger,
            fastDatabaseBulkInserter,
            postRequestProcessor,
            requestSpecificCache
        }),
        callOrder,
        databaseQueryFactory,
        queryManager,
        resourceMerger,
        fastDatabaseBulkInserter,
        postRequestProcessor,
        requestSpecificCache
    };
}

function createRequestInfo () {
    return new FhirRequestInfo({
        user: 'admin-user',
        scope: 'admin/*.*',
        requestId: 'request-1',
        userRequestId: 'user-request-1',
        method: 'POST',
        headers: {}
    });
}

describe('AdminResourceWriter', () => {
    BaseSerializer.setConfigManager({ preSaveCodingIdUpdateResources: ['Resource'] });

    let mocks;
    let requestInfo;
    let resource;

    const write = (overrides = {}) => mocks.writer.writeAsync({
        requestInfo,
        base_version: '4_0_0',
        resourceType: 'Person',
        resource,
        ...overrides
    });

    beforeEach(() => {
        mocks = createWriter();
        requestInfo = createRequestInfo();
        resource = { resourceType: 'Person', id: 'person-1', _uuid: 'person-uuid', link: [] };
    });

    describe('when the resource already exists', () => {
        test('merges, queues the update, flushes, drains the post-request queue and clears the request cache, in that order', async () => {
            await write();

            expect(mocks.callOrder).toEqual(['find', 'merge', 'queueUpdate', 'execute', 'drain', 'clear']);
            expect(mocks.fastDatabaseBulkInserter.insertOneAsync).not.toHaveBeenCalled();
        });

        test('looks the current resource up by _uuid on the primary', async () => {
            await write();

            expect(mocks.databaseQueryFactory.createQuery).toHaveBeenCalledWith({
                resourceType: 'Person',
                base_version: '4_0_0'
            });
            expect(mocks.queryManager.fastFindOneAsync).toHaveBeenCalledWith({
                query: { _uuid: 'person-uuid' },
                options: { readPreference: ReadPreference.PRIMARY }
            });
        });

        test('merges the resource into the current one and queues the merged result against the current version', async () => {
            await write();

            expect(mocks.resourceMerger.fastMergeResourceAsync).toHaveBeenCalledWith(expect.objectContaining({
                base_version: '4_0_0',
                currentResource,
                resourceToMerge: resource
            }));
            expect(mocks.fastDatabaseBulkInserter.mergeOneAsync).toHaveBeenCalledWith(expect.objectContaining({
                base_version: '4_0_0',
                resourceType: 'Person',
                doc: mergedResource,
                previousVersionId: '3',
                patches
            }));
        });

        test('drops fields that are not part of the resource before merging, and keeps the internal identifiers', async () => {
            await write({
                resource: {
                    resourceType: 'Person',
                    id: 'person-1',
                    _uuid: 'person-uuid',
                    _sourceId: 'person-1',
                    _sourceAssigningAuthority: 'bwell',
                    notAFhirField: 'x',
                    link: [{ target: { reference: 'Patient/p1', notAFhirField: 'x' }, notAFhirField: 'x' }]
                }
            });

            const { resourceToMerge } = mocks.resourceMerger.fastMergeResourceAsync.mock.calls[0][0];
            expect(resourceToMerge).toStrictEqual({
                resourceType: 'Person',
                id: 'person-1',
                _uuid: 'person-uuid',
                _sourceId: 'person-1',
                _sourceAssigningAuthority: 'bwell',
                link: [{ target: { reference: 'Patient/p1' } }]
            });
        });

        test('turns a single link object into the link array the Person schema requires', async () => {
            await write({
                resource: { resourceType: 'Person', id: 'person-1', _uuid: 'person-uuid', link: { target: { reference: 'Patient/p1' } } }
            });

            const { resourceToMerge } = mocks.resourceMerger.fastMergeResourceAsync.mock.calls[0][0];
            expect(resourceToMerge.link).toStrictEqual([{ target: { reference: 'Patient/p1' } }]);
        });

        test.each([
            [undefined, true],
            [true, true],
            [false, false]
        ])('passes smartMerge=%s to the merge and to the queued update as %s', async (smartMerge, expectedSmartMerge) => {
            await write({ smartMerge });

            expect(mocks.resourceMerger.fastMergeResourceAsync).toHaveBeenCalledWith(
                expect.objectContaining({ smartMerge: expectedSmartMerge })
            );
            expect(mocks.fastDatabaseBulkInserter.mergeOneAsync).toHaveBeenCalledWith(
                expect.objectContaining({ smartMerge: expectedSmartMerge })
            );
        });

        test('writes nothing when the merge finds no change', async () => {
            mocks.resourceMerger.fastMergeResourceAsync.mockResolvedValue({ updatedResource: null, patches: null });

            await expect(write()).resolves.toBeUndefined();

            expect(mocks.fastDatabaseBulkInserter.mergeOneAsync).not.toHaveBeenCalled();
            expect(mocks.fastDatabaseBulkInserter.executeAsync).not.toHaveBeenCalled();
            expect(mocks.postRequestProcessor.executeAsync).not.toHaveBeenCalled();
            expect(mocks.requestSpecificCache.clearAsync).toHaveBeenCalledTimes(1);
        });
    });

    describe('when the resource does not exist yet', () => {
        beforeEach(() => {
            mocks.queryManager.fastFindOneAsync.mockResolvedValue(null);
        });

        test('queues an insert, flushes, drains the post-request queue and clears the request cache, in that order', async () => {
            await write();

            expect(mocks.callOrder).toEqual(['queueInsert', 'execute', 'drain', 'clear']);
            expect(mocks.resourceMerger.fastMergeResourceAsync).not.toHaveBeenCalled();
            expect(mocks.fastDatabaseBulkInserter.mergeOneAsync).not.toHaveBeenCalled();
        });

        test('drops fields that are not part of the resource before inserting', async () => {
            await write({
                resource: { resourceType: 'Person', id: 'person-1', _uuid: 'person-uuid', notAFhirField: 'x', link: [] }
            });

            const insertArgs = mocks.fastDatabaseBulkInserter.insertOneAsync.mock.calls[0][0];
            expect(insertArgs.doc).not.toHaveProperty('notAFhirField');
        });

        test('inserts the resource stamped with a lastUpdated date', async () => {
            const before = Date.now();

            await write();

            const insertArgs = mocks.fastDatabaseBulkInserter.insertOneAsync.mock.calls[0][0];
            expect(insertArgs).toMatchObject({ base_version: '4_0_0', resourceType: 'Person' });
            expect(insertArgs.doc).toMatchObject({ id: 'person-1', _uuid: 'person-uuid' });
            expect(insertArgs.doc.meta.lastUpdated).toBeInstanceOf(Date);
            expect(insertArgs.doc.meta.lastUpdated.getTime()).toBeGreaterThanOrEqual(before);
        });

        test('keeps the other meta fields when stamping lastUpdated', async () => {
            resource.meta = { source: 'http://example.com', security: [{ system: 's', code: 'c' }] };

            await write();

            const { doc } = mocks.fastDatabaseBulkInserter.insertOneAsync.mock.calls[0][0];
            expect(doc.meta).toMatchObject({ source: 'http://example.com', security: [{ system: 's', code: 'c' }] });
        });
    });

    describe('request isolation', () => {
        test('runs the whole write under a request id of its own so draining and clearing cannot touch the caller\'s request', async () => {
            await write();

            const mergeRequestInfo = mocks.resourceMerger.fastMergeResourceAsync.mock.calls[0][0].requestInfo;
            const writeRequestId = mergeRequestInfo.requestId;
            expect(mergeRequestInfo).toBeInstanceOf(FhirRequestInfo);
            expect(writeRequestId).toBeTruthy();
            expect(writeRequestId).not.toBe('request-1');
            expect(mocks.fastDatabaseBulkInserter.mergeOneAsync.mock.calls[0][0].requestInfo).toBe(mergeRequestInfo);
            expect(mocks.fastDatabaseBulkInserter.executeAsync).toHaveBeenCalledWith({
                requestInfo: mergeRequestInfo,
                base_version: '4_0_0'
            });
            expect(mocks.postRequestProcessor.executeAsync).toHaveBeenCalledWith({ requestId: writeRequestId });
            expect(mocks.requestSpecificCache.clearAsync).toHaveBeenCalledWith({ requestId: writeRequestId });
            expect(requestInfo.requestId).toBe('request-1');
        });

        test('keeps the caller\'s identity on the request it writes with', async () => {
            await write();

            const mergeRequestInfo = mocks.resourceMerger.fastMergeResourceAsync.mock.calls[0][0].requestInfo;
            expect(mergeRequestInfo).toMatchObject({
                user: 'admin-user',
                scope: 'admin/*.*',
                userRequestId: 'user-request-1'
            });
        });

        test('uses a different request id for every write', async () => {
            await write();
            await write();

            const requestIds = mocks.resourceMerger.fastMergeResourceAsync.mock.calls.map(call => call[0].requestInfo.requestId);
            expect(new Set(requestIds).size).toBe(2);
        });
    });

    describe('history method', () => {
        const callerMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];

        test.each(callerMethods)('records an update as PATCH when the calling request is %s', async (callerMethod) => {
            requestInfo.method = callerMethod;

            await write();

            const mergeRequestInfo = mocks.resourceMerger.fastMergeResourceAsync.mock.calls[0][0].requestInfo;
            expect(mergeRequestInfo.method).toBe('PATCH');
            expect(mocks.fastDatabaseBulkInserter.mergeOneAsync.mock.calls[0][0].requestInfo.method).toBe('PATCH');
        });

        test.each(callerMethods)('records an insert as POST when the calling request is %s', async (callerMethod) => {
            mocks.queryManager.fastFindOneAsync.mockResolvedValue(null);
            requestInfo.method = callerMethod;

            await write();

            expect(mocks.fastDatabaseBulkInserter.insertOneAsync.mock.calls[0][0].requestInfo.method).toBe('POST');
        });

        test('leaves the calling request method as it was', async () => {
            requestInfo.method = 'DELETE';

            await write();

            expect(requestInfo.method).toBe('DELETE');
        });
    });

    test.each([
        [
            'a bulk write failure',
            (m) => m.fastDatabaseBulkInserter.executeAsync.mockResolvedValue([
                { resourceType: 'Person', uuid: 'person-uuid', issue: { code: 'exception' } }
            ]),
            /Failed to write Person\/person-uuid: exception/
        ],
        [
            'a merge exception',
            (m) => m.resourceMerger.fastMergeResourceAsync.mockRejectedValue(new Error('boom')),
            /boom/
        ],
        [
            'a failure to queue the update',
            (m) => m.fastDatabaseBulkInserter.mergeOneAsync.mockRejectedValue(new Error('queue failed')),
            /queue failed/
        ],
        [
            'a failed lookup of the current resource',
            (m) => m.queryManager.fastFindOneAsync.mockRejectedValue(new Error('lookup failed')),
            /lookup failed/
        ]
    ])('does not drain the post-request queue but still clears the request cache after %s', async (_name, arrange, expectedError) => {
        arrange(mocks);

        await expect(write()).rejects.toThrow(expectedError);

        expect(mocks.postRequestProcessor.executeAsync).not.toHaveBeenCalled();
        expect(mocks.requestSpecificCache.clearAsync).toHaveBeenCalledTimes(1);
    });
});
