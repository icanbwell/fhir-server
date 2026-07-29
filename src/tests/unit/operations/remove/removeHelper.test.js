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
const { DatabaseBulkInserter } = require('../../../../dataLayer/databaseBulkInserter');
const { PostRequestProcessor } = require('../../../../utils/postRequestProcessor');
const { PostSaveProcessor } = require('../../../../dataLayer/postSaveProcessor');
const { ACCESS_LOGS_ENTRY_DATA } = require('../../../../constants');

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
    let mockDatabaseBulkInserter;
    let mockPostRequestProcessor;
    let mockPostSaveProcessor;
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

        mockDatabaseBulkInserter = createMockInstance(DatabaseBulkInserter, {
            insertOneHistoryAsync: jest.fn().mockResolvedValue(undefined),
            executeHistoryAsync: jest.fn().mockResolvedValue(undefined)
        });

        mockPostRequestProcessor = createMockInstance(PostRequestProcessor, {
            add: jest.fn()
        });

        mockPostSaveProcessor = createMockInstance(PostSaveProcessor, {
            afterSaveAsync: jest.fn().mockResolvedValue(undefined)
        });

        removeHelper = new RemoveHelper({
            resourceLocatorFactory: mockResourceLocatorFactory,
            databaseQueryFactory: mockDatabaseQueryFactory,
            databaseAttachmentManager: mockDatabaseAttachmentManager,
            databaseBulkInserter: mockDatabaseBulkInserter,
            postRequestProcessor: mockPostRequestProcessor,
            postSaveProcessor: mockPostSaveProcessor
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
                databaseBulkInserter: mockDatabaseBulkInserter,
                postRequestProcessor: mockPostRequestProcessor,
                postSaveProcessor: mockPostSaveProcessor
            })).toThrow();
        });

        test('should throw if databaseBulkInserter is wrong type', () => {
            expect(() => new RemoveHelper({
                resourceLocatorFactory: mockResourceLocatorFactory,
                databaseQueryFactory: mockDatabaseQueryFactory,
                databaseAttachmentManager: mockDatabaseAttachmentManager,
                databaseBulkInserter: {},
                postRequestProcessor: mockPostRequestProcessor,
                postSaveProcessor: mockPostSaveProcessor
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
                expect(mockDatabaseBulkInserter.insertOneHistoryAsync).not.toHaveBeenCalled();
            });

            test('should still call executeHistoryAsync even with empty resources', async () => {
                httpContext.get.mockReturnValue(undefined);
                mockCollection.deleteMany.mockResolvedValue({ deletedCount: 0 });

                await removeHelper.deleteManyAsync({
                    ...baseParams,
                    resources: []
                });

                expect(mockDatabaseBulkInserter.executeHistoryAsync).toHaveBeenCalledWith({
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
                expect(mockDatabaseBulkInserter.insertOneHistoryAsync).toHaveBeenCalledTimes(1);
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
                expect(mockDatabaseBulkInserter.insertOneHistoryAsync).toHaveBeenCalledTimes(3);
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
                expect(mockDatabaseBulkInserter.insertOneHistoryAsync).toHaveBeenCalledTimes(1);
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
});
