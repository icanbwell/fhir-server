const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

// Mock express-http-context
jest.mock('express-http-context', () => ({
    get: jest.fn(),
    set: jest.fn()
}));

const httpContext = require('express-http-context');
const { RemoveHelper } = require('../../../../operations/remove/removeHelper');
const { ResourceLocatorFactory } = require('../../../../operations/common/resourceLocatorFactory');
const { DatabaseQueryFactory } = require('../../../../dataLayer/databaseQueryFactory');
const { DatabaseAttachmentManager } = require('../../../../dataLayer/databaseAttachmentManager');
const { FastDatabaseBulkInserter } = require('../../../../dataLayer/fastDatabaseBulkInserter');
const { PostRequestProcessor } = require('../../../../utils/postRequestProcessor');
const { PostSaveProcessor } = require('../../../../dataLayer/postSaveProcessor');
const { Base64DataManager } = require('../../../../dataLayer/base64DataManager');
const { ACCESS_LOGS_ENTRY_DATA } = require('../../../../constants');
const Resource = require('../../../../fhir/classes/4_0_0/resources/resource');
const Patient = require('../../../../fhir/classes/4_0_0/resources/patient');

/**
 * Helper to create a mock that passes assertTypeEquals
 */
function createMockInstance(ClassRef, methods = {}) {
    const instance = Object.create(ClassRef.prototype);
    Object.assign(instance, methods);
    return instance;
}

describe('RemoveHelper', () => {
    let removeHelper;
    let mockResourceLocatorFactory;
    let mockDatabaseQueryFactory;
    let mockDatabaseAttachmentManager;
    let mockFastDatabaseBulkInserter;
    let mockPostRequestProcessor;
    let mockPostSaveProcessor;
    let mockBase64DataManager;
    let mockCollection;

    beforeEach(() => {
        jest.clearAllMocks();

        mockCollection = {
            deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 })
        };

        mockResourceLocatorFactory = createMockInstance(ResourceLocatorFactory, {
            createResourceLocator: jest.fn().mockReturnValue({
                getCollectionAsync: jest.fn().mockResolvedValue(mockCollection)
            })
        });

        mockDatabaseQueryFactory = createMockInstance(DatabaseQueryFactory, {});

        mockDatabaseAttachmentManager = createMockInstance(DatabaseAttachmentManager, {
            transformAttachments: jest.fn().mockResolvedValue(undefined)
        });

        mockFastDatabaseBulkInserter = createMockInstance(FastDatabaseBulkInserter, {
            insertOneHistoryAsync: jest.fn().mockResolvedValue(undefined),
            executeHistoryAsync: jest.fn().mockResolvedValue(undefined)
        });

        mockPostRequestProcessor = createMockInstance(PostRequestProcessor, {
            add: jest.fn()
        });

        mockPostSaveProcessor = createMockInstance(PostSaveProcessor, {
            afterSaveAsync: jest.fn().mockResolvedValue(undefined)
        });

        mockBase64DataManager = createMockInstance(Base64DataManager, {
            getLiveObjectRefsOrResourceLastUpdated: jest.fn().mockReturnValue(new Map()),
            transformAsync: jest.fn().mockResolvedValue(undefined),
            deleteLiveObjectAsync: jest.fn().mockResolvedValue(undefined)
        });

        removeHelper = new RemoveHelper({
            resourceLocatorFactory: mockResourceLocatorFactory,
            databaseQueryFactory: mockDatabaseQueryFactory,
            databaseAttachmentManager: mockDatabaseAttachmentManager,
            postRequestProcessor: mockPostRequestProcessor,
            postSaveProcessor: mockPostSaveProcessor,
            base64DataManager: mockBase64DataManager,
            fastDatabaseBulkInserter: mockFastDatabaseBulkInserter
        });
    });

    describe('constructor', () => {
        test('should create instance with valid dependencies', () => {
            expect(removeHelper).toBeInstanceOf(RemoveHelper);
        });

        test('should throw if resourceLocatorFactory is null', () => {
            expect(() => new RemoveHelper({
                resourceLocatorFactory: null,
                databaseQueryFactory: mockDatabaseQueryFactory,
                databaseAttachmentManager: mockDatabaseAttachmentManager,
                    postRequestProcessor: mockPostRequestProcessor,
                postSaveProcessor: mockPostSaveProcessor,
                base64DataManager: mockBase64DataManager,
                fastDatabaseBulkInserter: mockFastDatabaseBulkInserter
            })).toThrow();
        });

        test('should throw if fastDatabaseBulkInserter is wrong type', () => {
            expect(() => new RemoveHelper({
                resourceLocatorFactory: mockResourceLocatorFactory,
                databaseQueryFactory: mockDatabaseQueryFactory,
                databaseAttachmentManager: mockDatabaseAttachmentManager,
                postRequestProcessor: mockPostRequestProcessor,
                postSaveProcessor: mockPostSaveProcessor,
                base64DataManager: mockBase64DataManager,
                fastDatabaseBulkInserter: {}
            })).toThrow();
        });

        test('should throw if fastDatabaseBulkInserter is null', () => {
            expect(() => new RemoveHelper({
                resourceLocatorFactory: mockResourceLocatorFactory,
                databaseQueryFactory: mockDatabaseQueryFactory,
                databaseAttachmentManager: mockDatabaseAttachmentManager,
                postRequestProcessor: mockPostRequestProcessor,
                postSaveProcessor: mockPostSaveProcessor,
                base64DataManager: mockBase64DataManager,
                fastDatabaseBulkInserter: null
            })).toThrow();
        });
    });

    describe('deleteManyAsync', () => {
        const baseRequestInfo = { requestId: 'test-request-123' };
        const baseParams = {
            requestInfo: baseRequestInfo,
            resourceType: 'Patient',
            base_version: '4_0_0'
        };

        describe('with 0 resources (empty array)', () => {
            test('should handle empty resources array', async () => {
                httpContext.get.mockReturnValue(undefined);
                mockCollection.deleteMany.mockResolvedValue({ deletedCount: 0 });

                const result = await removeHelper.deleteManyAsync({
                    ...baseParams,
                    resources: []
                });

                expect(result).toBe(0);
                expect(mockDatabaseAttachmentManager.transformAttachments).not.toHaveBeenCalled();
                expect(mockFastDatabaseBulkInserter.insertOneHistoryAsync).not.toHaveBeenCalled();
            });

            test('should still call executeHistoryAsync even with empty resources', async () => {
                httpContext.get.mockReturnValue(undefined);
                mockCollection.deleteMany.mockResolvedValue({ deletedCount: 0 });

                await removeHelper.deleteManyAsync({
                    ...baseParams,
                    resources: []
                });

                expect(mockFastDatabaseBulkInserter.executeHistoryAsync).toHaveBeenCalledWith({
                    requestInfo: baseRequestInfo,
                    base_version: '4_0_0'
                });
            });
        });

        describe('with 1 resource', () => {
            test('should delete a single resource', async () => {
                httpContext.get.mockReturnValue(undefined);
                mockCollection.deleteMany.mockResolvedValue({ deletedCount: 1 });

                const resource = {
                    id: 'patient-1',
                    _uuid: 'uuid-1',
                    _sourceAssigningAuthority: 'auth-1',
                    meta: { lastUpdated: null }
                };

                const result = await removeHelper.deleteManyAsync({
                    ...baseParams,
                    resources: [resource]
                });

                expect(result).toBe(1);
                expect(mockDatabaseAttachmentManager.transformAttachments).toHaveBeenCalledTimes(1);
                expect(mockFastDatabaseBulkInserter.insertOneHistoryAsync).toHaveBeenCalledTimes(1);
            });

            test('should set meta.lastUpdated on the resource', async () => {
                httpContext.get.mockReturnValue(undefined);
                mockCollection.deleteMany.mockResolvedValue({ deletedCount: 1 });

                const resource = {
                    id: 'patient-1',
                    _uuid: 'uuid-1',
                    _sourceAssigningAuthority: 'auth-1',
                    meta: { lastUpdated: null }
                };

                await removeHelper.deleteManyAsync({
                    ...baseParams,
                    resources: [resource]
                });

                expect(resource.meta.lastUpdated).toBeInstanceOf(Date);
            });

            test('preserveLastUpdated:true keeps the caller-supplied meta.lastUpdated instead of overwriting it with the current time', async () => {
                // Regression test: MongoGroupMemberRepository stamps a GroupMember delete
                // tombstone with the owning Group's own lastUpdated for four-way parity --
                // deleteManyAsync must not clobber that with "now" when this flag is set.
                httpContext.get.mockReturnValue(undefined);
                mockCollection.deleteMany.mockResolvedValue({ deletedCount: 1 });

                const callerSuppliedLastUpdated = new Date('2026-01-01T00:00:00.000Z');
                const resource = {
                    id: 'patient-1',
                    _uuid: 'uuid-1',
                    _sourceAssigningAuthority: 'auth-1',
                    meta: { lastUpdated: callerSuppliedLastUpdated }
                };

                await removeHelper.deleteManyAsync({
                    ...baseParams,
                    resources: [resource],
                    preserveLastUpdated: true
                });

                expect(resource.meta.lastUpdated).toBe(callerSuppliedLastUpdated);
            });
        });

        describe('with >1 resources', () => {
            test('should delete multiple resources', async () => {
                httpContext.get.mockReturnValue(undefined);
                mockCollection.deleteMany.mockResolvedValue({ deletedCount: 3 });

                const resources = [
                    { id: 'p-1', _uuid: 'u-1', _sourceAssigningAuthority: 'a', meta: { lastUpdated: null } },
                    { id: 'p-2', _uuid: 'u-2', _sourceAssigningAuthority: 'a', meta: { lastUpdated: null } },
                    { id: 'p-3', _uuid: 'u-3', _sourceAssigningAuthority: 'a', meta: { lastUpdated: null } }
                ];

                const result = await removeHelper.deleteManyAsync({
                    ...baseParams,
                    resources
                });

                expect(result).toBe(3);
                expect(mockDatabaseAttachmentManager.transformAttachments).toHaveBeenCalledTimes(3);
                expect(mockFastDatabaseBulkInserter.insertOneHistoryAsync).toHaveBeenCalledTimes(3);
            });

            test('should build query with all UUIDs', async () => {
                httpContext.get.mockReturnValue(undefined);
                mockCollection.deleteMany.mockResolvedValue({ deletedCount: 2 });

                const resources = [
                    { id: 'p-1', _uuid: 'u-1', _sourceAssigningAuthority: 'a', meta: { lastUpdated: null } },
                    { id: 'p-2', _uuid: 'u-2', _sourceAssigningAuthority: 'a', meta: { lastUpdated: null } }
                ];

                await removeHelper.deleteManyAsync({
                    ...baseParams,
                    resources
                });

                expect(mockCollection.deleteMany).toHaveBeenCalledWith(
                    { _uuid: { $in: ['u-1', 'u-2'] } },
                    {}
                );
            });
        });

        describe('null safety', () => {
            test('should skip null resources in the array', async () => {
                httpContext.get.mockReturnValue(undefined);
                mockCollection.deleteMany.mockResolvedValue({ deletedCount: 1 });

                const resources = [
                    null,
                    { id: 'p-1', _uuid: 'u-1', _sourceAssigningAuthority: 'a', meta: { lastUpdated: null } },
                    null
                ];

                const result = await removeHelper.deleteManyAsync({
                    ...baseParams,
                    resources
                });

                expect(result).toBe(1);
                expect(mockFastDatabaseBulkInserter.insertOneHistoryAsync).toHaveBeenCalledTimes(1);
            });

            test('should throw if resource has no _uuid', async () => {
                httpContext.get.mockReturnValue(undefined);

                const resources = [
                    { id: 'p-1', _uuid: undefined, meta: { lastUpdated: null } }
                ];

                await expect(removeHelper.deleteManyAsync({
                    ...baseParams,
                    resources
                })).rejects.toThrow();
            });

            test('BUG: crashes if resource.meta is null/undefined', async () => {
                // The code does resource.meta.lastUpdated = new Date(...)
                // If resource.meta is null, this will throw a TypeError
                httpContext.get.mockReturnValue(undefined);

                const resources = [
                    { id: 'p-1', _uuid: 'u-1', _sourceAssigningAuthority: 'a', meta: null }
                ];

                await expect(removeHelper.deleteManyAsync({
                    ...baseParams,
                    resources
                })).rejects.toThrow();
            });
        });

        describe('httpContext interaction', () => {
            test('should append to existing operationResult from httpContext', async () => {
                const existingResult = [{ id: 'existing', deleted: true }];
                httpContext.get.mockReturnValue({ operationResult: existingResult });
                mockCollection.deleteMany.mockResolvedValue({ deletedCount: 1 });

                const resources = [
                    { id: 'p-1', _uuid: 'u-1', _sourceAssigningAuthority: 'a', meta: { lastUpdated: null } }
                ];

                await removeHelper.deleteManyAsync({
                    ...baseParams,
                    resources
                });

                expect(httpContext.set).toHaveBeenCalledWith(
                    ACCESS_LOGS_ENTRY_DATA,
                    expect.objectContaining({
                        operationResult: expect.arrayContaining([
                            { id: 'existing', deleted: true },
                            expect.objectContaining({ id: 'p-1', deleted: true })
                        ])
                    })
                );
            });

            test('should handle httpContext.get returning undefined (no prior data)', async () => {
                httpContext.get.mockReturnValue(undefined);
                mockCollection.deleteMany.mockResolvedValue({ deletedCount: 1 });

                const resources = [
                    { id: 'p-1', _uuid: 'u-1', _sourceAssigningAuthority: 'a', meta: { lastUpdated: null } }
                ];

                await removeHelper.deleteManyAsync({
                    ...baseParams,
                    resources
                });

                // BUG: When httpContext.get returns undefined, the code does:
                //   const operationResult = httpContext.get(...)?.operationResult || [];
                // This works with undefined, but then sets new value. Let's verify:
                expect(httpContext.set).toHaveBeenCalledWith(
                    ACCESS_LOGS_ENTRY_DATA,
                    {
                        operationResult: [
                            expect.objectContaining({
                                id: 'p-1',
                                uuid: 'u-1',
                                resourceType: 'Patient',
                                deleted: true,
                                created: false,
                                updated: false
                            })
                        ]
                    }
                );
            });

            test('BUG: httpContext.set overwrites other fields in ACCESS_LOGS_ENTRY_DATA', async () => {
                // When httpContext.get returns an object with additional fields like streamRequestBody,
                // the code only sets { operationResult: [...] } which LOSES the other fields.
                const existingData = {
                    operationResult: [],
                    streamRequestBody: 'STREAMED {"id":"1"}'
                };
                httpContext.get.mockReturnValue(existingData);
                mockCollection.deleteMany.mockResolvedValue({ deletedCount: 1 });

                const resources = [
                    { id: 'p-1', _uuid: 'u-1', _sourceAssigningAuthority: 'a', meta: { lastUpdated: null } }
                ];

                await removeHelper.deleteManyAsync({
                    ...baseParams,
                    resources
                });

                // EXPECTED: correct behavior (will fail until bug is fixed)
                // The set call should preserve existing fields like streamRequestBody
                const setCall = httpContext.set.mock.calls[0][1];
                expect(setCall.streamRequestBody).toBe('STREAMED {"id":"1"}');
            });
        });

        describe('postRequestProcessor', () => {
            test('should add post-request task for non-AuditEvent resources', async () => {
                httpContext.get.mockReturnValue(undefined);
                mockCollection.deleteMany.mockResolvedValue({ deletedCount: 1 });

                const resources = [
                    { id: 'p-1', _uuid: 'u-1', _sourceAssigningAuthority: 'a', meta: { lastUpdated: null } }
                ];

                await removeHelper.deleteManyAsync({
                    ...baseParams,
                    resources
                });

                expect(mockPostRequestProcessor.add).toHaveBeenCalledWith(
                    expect.objectContaining({
                        requestId: 'test-request-123'
                    })
                );
            });

            test('should NOT add post-request task for AuditEvent resources', async () => {
                httpContext.get.mockReturnValue(undefined);
                mockCollection.deleteMany.mockResolvedValue({ deletedCount: 1 });

                const resources = [
                    { id: 'ae-1', _uuid: 'u-1', _sourceAssigningAuthority: 'a', meta: { lastUpdated: null } }
                ];

                await removeHelper.deleteManyAsync({
                    ...baseParams,
                    resourceType: 'AuditEvent',
                    resources
                });

                expect(mockPostRequestProcessor.add).not.toHaveBeenCalled();
            });
        });

        describe('skipAccessLogAndPostSave', () => {
            const makeResources = () => [
                { id: 'm-1', _uuid: 'u-1', _sourceAssigningAuthority: 'a', meta: { lastUpdated: new Date('2026-01-01T00:00:00.000Z') } },
                { id: 'm-2', _uuid: 'u-2', _sourceAssigningAuthority: 'a', meta: { lastUpdated: new Date('2026-01-01T00:00:00.000Z') } }
            ];

            test('does not record per-resource access-log entries', async () => {
                httpContext.get.mockReturnValue(undefined);
                mockCollection.deleteMany.mockResolvedValue({ deletedCount: 2 });

                await removeHelper.deleteManyAsync({
                    ...baseParams,
                    resourceType: 'GroupMember',
                    resources: makeResources(),
                    skipAccessLogAndPostSave: true
                });

                expect(httpContext.set).not.toHaveBeenCalled();
            });

            test('does not queue a post-save task, so no closure holds the deleted resources', async () => {
                httpContext.get.mockReturnValue(undefined);
                mockCollection.deleteMany.mockResolvedValue({ deletedCount: 2 });

                await removeHelper.deleteManyAsync({
                    ...baseParams,
                    resourceType: 'GroupMember',
                    resources: makeResources(),
                    skipAccessLogAndPostSave: true
                });

                expect(mockPostRequestProcessor.add).not.toHaveBeenCalled();
                expect(mockPostSaveProcessor.afterSaveAsync).not.toHaveBeenCalled();
            });

            test('still writes history before deleting and stamps the time', async () => {
                httpContext.get.mockReturnValue(undefined);
                const order = [];
                mockFastDatabaseBulkInserter.executeHistoryAsync.mockImplementation(async () => { order.push('history'); });
                mockCollection.deleteMany.mockImplementation(async () => { order.push('delete'); return { deletedCount: 2 }; });
                const resources = makeResources();
                const before = Date.now();

                await removeHelper.deleteManyAsync({
                    ...baseParams,
                    resourceType: 'GroupMember',
                    resources,
                    skipAccessLogAndPostSave: true
                });

                expect(order).toEqual(['history', 'delete']);
                for (const resource of resources) {
                    expect(resource.meta.lastUpdated.getTime()).toBeGreaterThanOrEqual(before);
                }
            });

            test('by default records an access-log entry for every deleted resource and queues the post-save task', async () => {
                httpContext.get.mockReturnValue(undefined);
                mockCollection.deleteMany.mockResolvedValue({ deletedCount: 2 });

                await removeHelper.deleteManyAsync({ ...baseParams, resources: makeResources() });

                expect(httpContext.set).toHaveBeenCalledTimes(1);
                expect(httpContext.set.mock.calls[0][1].operationResult).toHaveLength(2);
                expect(mockPostRequestProcessor.add).toHaveBeenCalledTimes(1);
            });
        });

        describe('error handling', () => {
            test('should wrap errors in RethrownError', async () => {
                httpContext.get.mockReturnValue(undefined);
                mockCollection.deleteMany.mockRejectedValue(new Error('DB connection lost'));

                const resources = [
                    { id: 'p-1', _uuid: 'u-1', _sourceAssigningAuthority: 'a', meta: { lastUpdated: null } }
                ];

                await expect(removeHelper.deleteManyAsync({
                    ...baseParams,
                    resources
                })).rejects.toThrow(/Error in deleteManyAsync/);
            });
        });
    });

    describe('deleteManyAsync history write', () => {
        const requestInfo = { requestId: 'fast-request-1' };
        const params = { requestInfo, resourceType: 'Patient', base_version: '4_0_0' };
        const makePlainPatient = () => ({
            resourceType: 'Patient',
            id: 'p-1',
            _uuid: 'u-1',
            _sourceAssigningAuthority: 'a',
            meta: { versionId: '1', lastUpdated: null },
            identifier: []
        });

        beforeEach(() => {
            httpContext.get.mockReturnValue(undefined);
            mockCollection.deleteMany.mockResolvedValue({ deletedCount: 1 });
        });

        test('uses the fast inserter for every resource and flushes it before the delete', async () => {
            mockCollection.deleteMany.mockResolvedValue({ deletedCount: 2 });
            const resources = [makePlainPatient(), { ...makePlainPatient(), id: 'p-2', _uuid: 'u-2' }];

            await removeHelper.deleteManyAsync({ ...params, resources });

            expect(mockFastDatabaseBulkInserter.insertOneHistoryAsync).toHaveBeenCalledTimes(2);
            expect(mockFastDatabaseBulkInserter.executeHistoryAsync).toHaveBeenCalledTimes(1);
            expect(mockFastDatabaseBulkInserter.executeHistoryAsync).toHaveBeenCalledWith({
                requestInfo,
                base_version: '4_0_0'
            });
            expect(mockFastDatabaseBulkInserter.executeHistoryAsync.mock.invocationCallOrder[0])
                .toBeLessThan(mockCollection.deleteMany.mock.invocationCallOrder[0]);
        });

        test('passes resourceType, base_version and requestInfo, without skipResourceAssertion', async () => {
            await removeHelper.deleteManyAsync({ ...params, resources: [makePlainPatient()] });

            const args = mockFastDatabaseBulkInserter.insertOneHistoryAsync.mock.calls[0][0];
            expect(args.requestInfo).toBe(requestInfo);
            expect(args.base_version).toBe('4_0_0');
            expect(args.resourceType).toBe('Patient');
            expect('skipResourceAssertion' in args).toBe(false);
        });

        test('passes a plain snapshot for a Resource instance', async () => {
            const patient = new Patient({
                id: 'p-1',
                meta: { versionId: '1' },
                identifier: [{ system: 'http://example.com/mrn', value: 'mrn-1' }],
                _uuid: 'u-1',
                _sourceAssigningAuthority: 'a'
            });

            await removeHelper.deleteManyAsync({ ...params, resources: [patient] });

            const doc = mockFastDatabaseBulkInserter.insertOneHistoryAsync.mock.calls[0][0].doc;
            expect(doc).not.toBeInstanceOf(Resource);
            expect(doc).toStrictEqual(patient.toJSONInternal());
        });

        test('does not pass the caller\'s object', async () => {
            const resource = makePlainPatient();

            await removeHelper.deleteManyAsync({ ...params, resources: [resource] });

            const doc = mockFastDatabaseBulkInserter.insertOneHistoryAsync.mock.calls[0][0].doc;
            expect(doc).not.toBe(resource);
            expect(doc.meta).not.toBe(resource.meta);
            expect(doc).toStrictEqual(resource);
        });

        test('caller\'s object is unchanged when the inserter mutates the snapshot', async () => {
            // The real fast inserter write-serializes the doc in place (drops empties/unknown keys).
            mockFastDatabaseBulkInserter.insertOneHistoryAsync.mockImplementation(async ({ doc }) => {
                delete doc.identifier;
                delete doc.meta;
            });
            const resource = makePlainPatient();

            await removeHelper.deleteManyAsync({ ...params, resources: [resource] });

            expect(resource.identifier).toStrictEqual([]);
            expect(resource.meta.lastUpdated).toBeInstanceOf(Date);
        });

        test('snapshot is taken after the base64 and attachment transforms', async () => {
            mockDatabaseAttachmentManager.transformAttachments.mockImplementation(async (resource) => {
                resource.content = [{ attachment: { _file_id: 'file-1' } }];
            });
            mockBase64DataManager.transformAsync.mockImplementation(async (resource) => {
                resource._blobMeta = { hash: 'h' };
            });

            await removeHelper.deleteManyAsync({ ...params, resources: [makePlainPatient()] });

            const doc = mockFastDatabaseBulkInserter.insertOneHistoryAsync.mock.calls[0][0].doc;
            expect(doc._blobMeta.hash).toBe('h');
            expect(doc.content[0].attachment._file_id).toBe('file-1');
        });

        test('snapshot carries the stamped meta.lastUpdated', async () => {
            const before = Date.now();

            await removeHelper.deleteManyAsync({ ...params, resources: [makePlainPatient()] });

            const doc = mockFastDatabaseBulkInserter.insertOneHistoryAsync.mock.calls[0][0].doc;
            expect(doc.meta.lastUpdated).toBeInstanceOf(Date);
            expect(doc.meta.lastUpdated.getTime()).toBeGreaterThanOrEqual(before);
        });

        test('preserveLastUpdated keeps the caller\'s Date in the snapshot', async () => {
            const groupLastUpdated = new Date('2026-01-01T00:00:00.000Z');
            const resource = { ...makePlainPatient(), meta: { versionId: '4', lastUpdated: groupLastUpdated } };

            await removeHelper.deleteManyAsync({
                ...params,
                resourceType: 'GroupMember',
                resources: [resource],
                preserveLastUpdated: true
            });

            const doc = mockFastDatabaseBulkInserter.insertOneHistoryAsync.mock.calls[0][0].doc;
            expect(doc.meta.lastUpdated).toStrictEqual(groupLastUpdated);
            expect(resource.meta.lastUpdated).toBe(groupLastUpdated);
        });

        test('post-save receives the original resource objects', async () => {
            const resource = makePlainPatient();

            await removeHelper.deleteManyAsync({ ...params, resources: [resource] });
            const { fnTask } = mockPostRequestProcessor.add.mock.calls[0][0];
            await fnTask();

            expect(mockPostSaveProcessor.afterSaveAsync).toHaveBeenCalledWith(
                expect.objectContaining({ eventType: 'D', resourceType: 'Patient' })
            );
            expect(mockPostSaveProcessor.afterSaveAsync.mock.calls[0][0].doc).toBe(resource);
        });

        test('live-object cleanup uses the original resource after the delete', async () => {
            mockBase64DataManager.getLiveObjectRefsOrResourceLastUpdated.mockReturnValue(
                new Map([['/data', '2026-01-01T00:00:00.000Z']])
            );

            await removeHelper.deleteManyAsync({ ...params, resources: [makePlainPatient()] });

            expect(mockBase64DataManager.deleteLiveObjectAsync).toHaveBeenCalledWith('Patient', 'u-1', '2026-01-01T00:00:00.000Z');
            expect(mockBase64DataManager.deleteLiveObjectAsync.mock.invocationCallOrder[0])
                .toBeGreaterThan(mockCollection.deleteMany.mock.invocationCallOrder[0]);
        });

        test('a failed history flush aborts the delete', async () => {
            mockFastDatabaseBulkInserter.executeHistoryAsync.mockRejectedValue(new Error('history write failed'));

            await expect(removeHelper.deleteManyAsync({ ...params, resources: [makePlainPatient()] }))
                .rejects.toThrow(/Error in deleteManyAsync/);
            expect(mockCollection.deleteMany).not.toHaveBeenCalled();
        });
    });
});
