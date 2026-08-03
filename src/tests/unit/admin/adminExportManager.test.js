/**
 * Unit tests for AdminExportManager
 * Focuses on: cache key mismatch, null safety, serialize return value bug
 */
const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

// Mock modules before requiring AdminExportManager
jestGlobal.mock('../../../operations/fhirOperationsManager', () => {
    class FhirOperationsManager {
        getRequestInfo() { return { requestId: 'req-1' }; }
        async searchById() { return {}; }
        async search() { return {}; }
        async getParsedArgsAsync() { return {}; }
    }
    return { FhirOperationsManager };
});

jestGlobal.mock('../../../dataLayer/databaseExportManager', () => {
    class DatabaseExportManager {
        async getExportStatusResourceWithId() { return null; }
        async updateExportStatusAsync() { return; }
    }
    return { DatabaseExportManager };
});

jestGlobal.mock('../../../operations/common/resourceMerger', () => {
    class ResourceMerger {
        async mergeResourceAsync() { return { updatedResource: null }; }
    }
    return { ResourceMerger };
});

jestGlobal.mock('../../../utils/k8sClient', () => {
    class K8sClient {}
    return { K8sClient };
});

jestGlobal.mock('../../../operations/export/exportManager', () => {
    class ExportManager {
        async triggerExportJob() { return {}; }
    }
    return { ExportManager };
});

jestGlobal.mock('../../../operations/security/scopesValidator', () => {
    class ScopesValidator {
        async verifyHasValidScopesAsync() { return; }
    }
    return { ScopesValidator };
});

jestGlobal.mock('../../../dataLayer/postSaveProcessor', () => {
    class PostSaveProcessor {
        async afterSaveAsync() { return; }
    }
    return { PostSaveProcessor };
});

jestGlobal.mock('../../../utils/bulkExportEventProducer', () => {
    class BulkExportEventProducer {
        async produce() { return; }
    }
    return { BulkExportEventProducer };
});

jestGlobal.mock('../../../utils/configManager', () => {
    class ConfigManager {}
    return { ConfigManager };
});

jestGlobal.mock('express-http-context', () => ({
    get: jestGlobal.fn(),
    set: jestGlobal.fn()
}));

jestGlobal.mock('../../../operations/common/logging', () => ({
    logInfo: jestGlobal.fn(),
    logDebug: jestGlobal.fn(),
    logError: jestGlobal.fn(),
    logWarn: jestGlobal.fn()
}));

jestGlobal.mock('../../../fhir/fhirResourceSerializer', () => ({
    FhirResourceSerializer: {
        serialize: jestGlobal.fn((obj) => {
            // Return a serialized version (different object) to test if caller uses it
            if (obj) return { ...obj, _serialized: true };
            return obj;
        })
    }
}));

jestGlobal.mock('../../../fhir/fhirResourceCreator', () => ({
    FhirResourceCreator: {
        createByResourceType: jestGlobal.fn((body, type) => ({ ...body, resourceType: type }))
    }
}));

jestGlobal.mock('../../../../src/operations/common/get_all_args', () => ({
    get_all_args: jestGlobal.fn((req, args) => ({ ...args }))
}));

jestGlobal.mock('../../../utils/uid.util', () => ({
    generateUUID: jestGlobal.fn(() => 'generated-uuid-123')
}));

// Now require the modules
const httpContext = require('express-http-context');
const { AdminExportManager } = require('../../../admin/adminExportManager');
const { PostRequestProcessor } = require('../../../utils/postRequestProcessor');
const { RequestSpecificCache } = require('../../../utils/requestSpecificCache');
const { FhirOperationsManager } = require('../../../operations/fhirOperationsManager');
const { DatabaseExportManager } = require('../../../dataLayer/databaseExportManager');
const { ResourceMerger } = require('../../../operations/common/resourceMerger');
const { ConfigManager } = require('../../../utils/configManager');
const { K8sClient } = require('../../../utils/k8sClient');
const { ExportManager } = require('../../../operations/export/exportManager');
const { ScopesValidator } = require('../../../operations/security/scopesValidator');
const { PostSaveProcessor } = require('../../../dataLayer/postSaveProcessor');
const { BulkExportEventProducer } = require('../../../utils/bulkExportEventProducer');
const { FhirResourceSerializer } = require('../../../fhir/fhirResourceSerializer');
const { REQUEST_ID_TYPE } = require('../../../constants');

function createMockInstance(ClassType) {
    return Object.create(ClassType.prototype);
}

describe('AdminExportManager', () => {
    let manager;
    let mockPostRequestProcessor;
    let mockRequestSpecificCache;
    let mockFhirOperationsManager;
    let mockDatabaseExportManager;
    let mockResourceMerger;
    let mockConfigManager;
    let mockK8sClient;
    let mockExportManager;
    let mockScopesValidator;
    let mockPostSaveProcessor;
    let mockBulkExportEventProducer;

    beforeEach(() => {
        jestGlobal.clearAllMocks();

        mockRequestSpecificCache = createMockInstance(RequestSpecificCache);
        mockRequestSpecificCache.getList = jestGlobal.fn().mockReturnValue([]);
        mockRequestSpecificCache.clearAsync = jestGlobal.fn().mockResolvedValue(undefined);
        mockRequestSpecificCache.getRequestIds = jestGlobal.fn().mockReturnValue([]);

        mockPostRequestProcessor = createMockInstance(PostRequestProcessor);
        mockPostRequestProcessor.executeAsync = jestGlobal.fn().mockResolvedValue(undefined);
        mockPostRequestProcessor.add = jestGlobal.fn();

        mockFhirOperationsManager = createMockInstance(FhirOperationsManager);
        mockFhirOperationsManager.searchById = jestGlobal.fn().mockResolvedValue({
            resourceType: 'ExportStatus',
            id: 'test-id',
            status: 'completed'
        });
        mockFhirOperationsManager.search = jestGlobal.fn().mockResolvedValue({
            resourceType: 'Bundle',
            entry: []
        });
        mockFhirOperationsManager.getRequestInfo = jestGlobal.fn().mockReturnValue({
            requestId: 'req-1'
        });
        mockFhirOperationsManager.getParsedArgsAsync = jestGlobal.fn().mockResolvedValue({});

        mockDatabaseExportManager = createMockInstance(DatabaseExportManager);
        mockDatabaseExportManager.getExportStatusResourceWithId = jestGlobal.fn().mockResolvedValue(null);
        mockDatabaseExportManager.updateExportStatusAsync = jestGlobal.fn().mockResolvedValue(undefined);

        mockResourceMerger = createMockInstance(ResourceMerger);
        mockResourceMerger.mergeResourceAsync = jestGlobal.fn().mockResolvedValue({ updatedResource: null });

        mockConfigManager = createMockInstance(ConfigManager);
        mockK8sClient = createMockInstance(K8sClient);

        mockExportManager = createMockInstance(ExportManager);
        mockExportManager.triggerExportJob = jestGlobal.fn().mockResolvedValue({ status: 'triggered' });

        mockScopesValidator = createMockInstance(ScopesValidator);
        mockScopesValidator.verifyHasValidScopesAsync = jestGlobal.fn().mockResolvedValue(undefined);

        mockPostSaveProcessor = createMockInstance(PostSaveProcessor);
        mockPostSaveProcessor.afterSaveAsync = jestGlobal.fn().mockResolvedValue(undefined);

        mockBulkExportEventProducer = createMockInstance(BulkExportEventProducer);
        mockBulkExportEventProducer.produce = jestGlobal.fn().mockResolvedValue(undefined);

        manager = new AdminExportManager({
            postRequestProcessor: mockPostRequestProcessor,
            requestSpecificCache: mockRequestSpecificCache,
            fhirOperationsManager: mockFhirOperationsManager,
            databaseExportManager: mockDatabaseExportManager,
            resourceMerger: mockResourceMerger,
            configManager: mockConfigManager,
            k8sClient: mockK8sClient,
            exportManager: mockExportManager,
            scopesValidator: mockScopesValidator,
            postSaveProcessor: mockPostSaveProcessor,
            bulkExportEventProducer: mockBulkExportEventProducer
        });
    });

    describe('getExportStatus', () => {
        test('should set requestId in httpContext', async () => {
            httpContext.get.mockReturnValue('system-req-id');
            const req = {
                id: 'user-req-123',
                header: jestGlobal.fn(),
                params: { id: 'export-1' }
            };
            const res = {};

            await manager.getExportStatus({ req, res });

            expect(httpContext.set).toHaveBeenCalledWith('requestId', 'user-req-123');
        });

        test('should search by id when req.params.id is provided', async () => {
            httpContext.get.mockReturnValue('system-req-id');
            const req = {
                id: 'user-req-123',
                header: jestGlobal.fn(),
                params: { id: 'export-1' }
            };
            const res = {};

            await manager.getExportStatus({ req, res });

            expect(mockFhirOperationsManager.searchById).toHaveBeenCalled();
        });

        test('should search all when req.params.id is not provided', async () => {
            httpContext.get.mockReturnValue('system-req-id');
            const req = {
                id: 'user-req-123',
                header: jestGlobal.fn(),
                params: {}
            };
            const res = {};

            await manager.getExportStatus({ req, res });

            expect(mockFhirOperationsManager.search).toHaveBeenCalled();
        });

        test('BUG: serialize return value is discarded - returned resource is not serialized', async () => {
            // This test demonstrates that FhirResourceSerializer.serialize() return value
            // is ignored on lines 133-134 of adminExportManager.js
            httpContext.get.mockReturnValue('system-req-id');
            const mockResource = {
                resourceType: 'ExportStatus',
                id: 'test-1',
                status: 'completed'
            };
            mockFhirOperationsManager.searchById.mockResolvedValue(mockResource);

            const req = {
                id: 'user-req-123',
                header: jestGlobal.fn(),
                params: { id: 'export-1' }
            };
            const res = {};

            const result = await manager.getExportStatus({ req, res });

            // FhirResourceSerializer.serialize was called
            expect(FhirResourceSerializer.serialize).toHaveBeenCalledWith(mockResource);

            // EXPECTED: correct behavior (will fail until bug is fixed)
            // The result should be the serialized version (serialize return value should be used)
            expect(result._serialized).toBe(true);
        });

        test('BUG: serialize return value is discarded for bundle search', async () => {
            httpContext.get.mockReturnValue('system-req-id');
            const mockBundle = {
                resourceType: 'Bundle',
                entry: [{ resource: { id: '1' } }]
            };
            mockFhirOperationsManager.search.mockResolvedValue(mockBundle);

            const req = {
                id: 'user-req-123',
                header: jestGlobal.fn(),
                params: {}
            };
            const res = {};

            const result = await manager.getExportStatus({ req, res });

            expect(FhirResourceSerializer.serialize).toHaveBeenCalledWith(mockBundle);
            // EXPECTED: correct behavior (will fail until bug is fixed)
            // The result should be the serialized version (serialize return value should be used)
            expect(result._serialized).toBe(true);
        });

        test('BUG: finally block uses different httpContext key than what was set', async () => {
            // The code sets: httpContext.set('requestId', req.id)
            // But reads: httpContext.get(REQUEST_ID_TYPE.SYSTEM_GENERATED_REQUEST_ID)
            // which is 'systemGeneratedRequestId' - a DIFFERENT key
            // If middleware hasn't set this key, requestId will be undefined

            // Simulate the scenario where SYSTEM_GENERATED_REQUEST_ID was never set
            httpContext.get.mockImplementation((key) => {
                if (key === REQUEST_ID_TYPE.SYSTEM_GENERATED_REQUEST_ID) {
                    return undefined; // NOT set by adminExportManager
                }
                return null;
            });

            const req = {
                id: 'user-req-123',
                header: jestGlobal.fn(),
                params: { id: 'export-1' }
            };
            const res = {};

            await manager.getExportStatus({ req, res });

            // EXPECTED: correct behavior (will fail until bug is fixed)
            // The finally block should use the correct requestId (the one that was set)
            expect(mockPostRequestProcessor.executeAsync).toHaveBeenCalledWith({
                requestId: 'user-req-123'
            });
            expect(mockRequestSpecificCache.clearAsync).toHaveBeenCalledWith({
                requestId: 'user-req-123'
            });
        });

        test('generates UUID when req.id is not provided and no header', async () => {
            httpContext.get.mockReturnValue('system-req-id');
            const req = {
                id: undefined,
                header: jestGlobal.fn().mockReturnValue(undefined),
                params: { id: 'export-1' }
            };
            const res = {};

            await manager.getExportStatus({ req, res });

            expect(req.id).toBe('generated-uuid-123');
        });

        test('uses x-request-id header when req.id is not set', async () => {
            httpContext.get.mockReturnValue('system-req-id');
            const req = {
                id: undefined,
                header: jestGlobal.fn().mockReturnValue('header-req-id'),
                params: { id: 'export-1' }
            };
            const res = {};

            await manager.getExportStatus({ req, res });

            expect(req.id).toBe('header-req-id');
        });

        test('rethrows error from fhirOperationsManager', async () => {
            httpContext.get.mockReturnValue('system-req-id');
            const testError = new Error('search failed');
            mockFhirOperationsManager.searchById.mockRejectedValue(testError);

            const req = {
                id: 'user-req-123',
                header: jestGlobal.fn(),
                params: { id: 'export-1' }
            };
            const res = {};

            await expect(manager.getExportStatus({ req, res })).rejects.toThrow('search failed');
        });

        test('finally block executes even when error occurs', async () => {
            httpContext.get.mockReturnValue('system-req-id');
            mockFhirOperationsManager.searchById.mockRejectedValue(new Error('fail'));

            const req = {
                id: 'user-req-123',
                header: jestGlobal.fn(),
                params: { id: 'export-1' }
            };
            const res = {};

            await expect(manager.getExportStatus({ req, res })).rejects.toThrow();
            expect(mockPostRequestProcessor.executeAsync).toHaveBeenCalled();
            expect(mockRequestSpecificCache.clearAsync).toHaveBeenCalled();
        });
    });

    describe('updateExportStatus', () => {
        test('throws NotFoundError when export status resource not found', async () => {
            httpContext.get.mockReturnValue('system-req-id');
            mockDatabaseExportManager.getExportStatusResourceWithId.mockResolvedValue(null);

            const req = {
                id: 'user-req-123',
                header: jestGlobal.fn(),
                params: { id: 'export-1' },
                headers: {},
                body: { resourceType: 'ExportStatus' },
                sanitized_args: {},
                query: {}
            };
            const res = {};

            await expect(manager.updateExportStatus({ req, res })).rejects.toThrow(
                /ExportStatus resoure with id export-1 doesn't exists/
            );
        });

        test('returns exportResource when mergeResourceAsync returns null updatedResource', async () => {
            httpContext.get.mockReturnValue('system-req-id');
            const existingResource = { resourceType: 'ExportStatus', id: 'export-1', status: 'in-progress' };
            mockDatabaseExportManager.getExportStatusResourceWithId.mockResolvedValue(existingResource);
            mockResourceMerger.mergeResourceAsync.mockResolvedValue({ updatedResource: null });

            const req = {
                id: 'user-req-123',
                header: jestGlobal.fn(),
                params: { id: 'export-1' },
                headers: {},
                body: { resourceType: 'ExportStatus', status: 'completed' },
                sanitized_args: {},
                query: {}
            };
            const res = {};

            const result = await manager.updateExportStatus({ req, res });

            // When updatedResource is null/falsy, returns the exportResource (from FhirResourceCreator)
            expect(result.resourceType).toBe('ExportStatus');
            expect(mockDatabaseExportManager.updateExportStatusAsync).not.toHaveBeenCalled();
        });

        test('updates and returns updatedResource when merge produces changes', async () => {
            httpContext.get.mockReturnValue('system-req-id');
            const existingResource = { resourceType: 'ExportStatus', id: 'export-1', status: 'in-progress' };
            const updatedResource = { resourceType: 'ExportStatus', id: 'export-1', status: 'completed' };
            mockDatabaseExportManager.getExportStatusResourceWithId.mockResolvedValue(existingResource);
            mockResourceMerger.mergeResourceAsync.mockResolvedValue({ updatedResource });

            const req = {
                id: 'user-req-123',
                header: jestGlobal.fn(),
                params: { id: 'export-1' },
                headers: {},
                body: { resourceType: 'ExportStatus', status: 'completed' },
                sanitized_args: {},
                query: {}
            };
            const res = {};

            const result = await manager.updateExportStatus({ req, res });

            expect(result).toBe(updatedResource);
            expect(mockDatabaseExportManager.updateExportStatusAsync).toHaveBeenCalledWith({
                exportStatusResource: updatedResource
            });
            expect(mockPostRequestProcessor.add).toHaveBeenCalled();
            expect(mockBulkExportEventProducer.produce).toHaveBeenCalledWith({
                resource: updatedResource,
                requestId: 'user-req-123'
            });
        });

        test('BUG: finally block uses wrong httpContext key for cache cleanup', async () => {
            // Same bug as getExportStatus - uses SYSTEM_GENERATED_REQUEST_ID key
            httpContext.get.mockImplementation((key) => {
                if (key === REQUEST_ID_TYPE.SYSTEM_GENERATED_REQUEST_ID) {
                    return undefined;
                }
                return null;
            });

            const existingResource = { resourceType: 'ExportStatus', id: 'export-1' };
            mockDatabaseExportManager.getExportStatusResourceWithId.mockResolvedValue(existingResource);
            mockResourceMerger.mergeResourceAsync.mockResolvedValue({ updatedResource: null });

            const req = {
                id: 'user-req-123',
                header: jestGlobal.fn(),
                params: { id: 'export-1' },
                headers: {},
                body: { resourceType: 'ExportStatus' },
                sanitized_args: {},
                query: {}
            };
            const res = {};

            await manager.updateExportStatus({ req, res });

            // EXPECTED: correct behavior (will fail until bug is fixed)
            // Should use the correct requestId (the one that was set) for cleanup
            expect(mockPostRequestProcessor.executeAsync).toHaveBeenCalledWith({
                requestId: 'user-req-123'
            });
            expect(mockRequestSpecificCache.clearAsync).toHaveBeenCalledWith({
                requestId: 'user-req-123'
            });
        });
    });

    describe('triggerExportJob', () => {
        test('throws NotFoundError when export status resource not found', async () => {
            httpContext.get.mockReturnValue('system-req-id');
            mockDatabaseExportManager.getExportStatusResourceWithId.mockResolvedValue(null);

            const req = {
                id: 'user-req-123',
                header: jestGlobal.fn(),
                params: { id: 'export-1' },
                headers: {},
                sanitized_args: {},
                query: {}
            };
            const res = {};

            await expect(manager.triggerExportJob({ req, res })).rejects.toThrow(
                /ExportStatus resoure with id export-1 doesn't exists/
            );
        });

        test('calls exportManager.triggerExportJob when resource exists', async () => {
            httpContext.get.mockReturnValue('system-req-id');
            const existingResource = { resourceType: 'ExportStatus', id: 'export-1' };
            mockDatabaseExportManager.getExportStatusResourceWithId.mockResolvedValue(existingResource);

            const req = {
                id: 'user-req-123',
                header: jestGlobal.fn(),
                params: { id: 'export-1' },
                headers: {},
                sanitized_args: {},
                query: {}
            };
            const res = {};

            const result = await manager.triggerExportJob({ req, res });

            expect(mockExportManager.triggerExportJob).toHaveBeenCalledWith({
                exportStatusResource: existingResource,
                requestId: 'req-1'
            });
            expect(result).toEqual({ status: 'triggered' });
        });

        test('BUG: triggerExportJob has no finally block for cache cleanup', async () => {
            // Unlike getExportStatus and updateExportStatus, triggerExportJob
            // does NOT have a finally block to call postRequestProcessor.executeAsync
            // or requestSpecificCache.clearAsync. This means tasks added to
            // the post-request queue during this operation will never execute,
            // and cached data will never be cleaned up.
            httpContext.get.mockReturnValue('system-req-id');
            const existingResource = { resourceType: 'ExportStatus', id: 'export-1' };
            mockDatabaseExportManager.getExportStatusResourceWithId.mockResolvedValue(existingResource);

            const req = {
                id: 'user-req-123',
                header: jestGlobal.fn(),
                params: { id: 'export-1' },
                headers: {},
                sanitized_args: {},
                query: {}
            };
            const res = {};

            await manager.triggerExportJob({ req, res });

            // EXPECTED: correct behavior (will fail until bug is fixed)
            // Should have a finally block that performs cleanup like other methods
            expect(mockPostRequestProcessor.executeAsync).toHaveBeenCalled();
            expect(mockRequestSpecificCache.clearAsync).toHaveBeenCalled();
        });

        test('does not set req.id like other methods do', async () => {
            // triggerExportJob does not have the req.id initialization pattern
            // that getExportStatus and updateExportStatus have
            httpContext.get.mockReturnValue('system-req-id');
            const existingResource = { resourceType: 'ExportStatus', id: 'export-1' };
            mockDatabaseExportManager.getExportStatusResourceWithId.mockResolvedValue(existingResource);

            const req = {
                id: undefined,
                header: jestGlobal.fn(),
                params: { id: 'export-1' },
                headers: {},
                sanitized_args: {},
                query: {}
            };
            const res = {};

            await manager.triggerExportJob({ req, res });

            // req.id is still undefined - triggerExportJob doesn't set it
            expect(req.id).toBeUndefined();
        });

        test('rethrows error from scopesValidator', async () => {
            httpContext.get.mockReturnValue('system-req-id');
            const scopeError = new Error('Insufficient scopes');
            mockScopesValidator.verifyHasValidScopesAsync.mockRejectedValue(scopeError);

            const req = {
                id: 'user-req-123',
                header: jestGlobal.fn(),
                params: { id: 'export-1' },
                headers: {},
                sanitized_args: {},
                query: {}
            };
            const res = {};

            await expect(manager.triggerExportJob({ req, res })).rejects.toThrow('Insufficient scopes');
        });

        test('rethrows error from exportManager.triggerExportJob', async () => {
            httpContext.get.mockReturnValue('system-req-id');
            const existingResource = { resourceType: 'ExportStatus', id: 'export-1' };
            mockDatabaseExportManager.getExportStatusResourceWithId.mockResolvedValue(existingResource);
            mockExportManager.triggerExportJob.mockRejectedValue(new Error('Export job failed'));

            const req = {
                id: 'user-req-123',
                header: jestGlobal.fn(),
                params: { id: 'export-1' },
                headers: {},
                sanitized_args: {},
                query: {}
            };
            const res = {};

            await expect(manager.triggerExportJob({ req, res })).rejects.toThrow('Export job failed');
        });
    });

    describe('updateExportStatus - additional coverage', () => {
        test('rethrows error from scopesValidator', async () => {
            httpContext.get.mockReturnValue('system-req-id');
            const scopeError = new Error('Access denied');
            mockScopesValidator.verifyHasValidScopesAsync.mockRejectedValue(scopeError);

            const req = {
                id: 'user-req-123',
                header: jestGlobal.fn(),
                params: { id: 'export-1' },
                headers: {},
                body: { resourceType: 'ExportStatus' },
                sanitized_args: {},
                query: {}
            };
            const res = {};

            await expect(manager.updateExportStatus({ req, res })).rejects.toThrow('Access denied');
        });

        test('calls postRequestProcessor.add with fnTask that invokes postSaveProcessor', async () => {
            httpContext.get.mockReturnValue('system-req-id');
            const existingResource = { resourceType: 'ExportStatus', id: 'export-1', status: 'in-progress' };
            const updatedResource = { resourceType: 'ExportStatus', id: 'export-1', status: 'completed' };
            mockDatabaseExportManager.getExportStatusResourceWithId.mockResolvedValue(existingResource);
            mockResourceMerger.mergeResourceAsync.mockResolvedValue({ updatedResource });

            const req = {
                id: 'user-req-123',
                header: jestGlobal.fn(),
                params: { id: 'export-1' },
                headers: {},
                body: { resourceType: 'ExportStatus', status: 'completed' },
                sanitized_args: {},
                query: {}
            };
            const res = {};

            await manager.updateExportStatus({ req, res });

            // Verify the fnTask is a function
            const addCall = mockPostRequestProcessor.add.mock.calls[0][0];
            expect(addCall.requestId).toBe('user-req-123');
            expect(typeof addCall.fnTask).toBe('function');

            // Execute the fnTask and verify it calls postSaveProcessor
            await addCall.fnTask();
            expect(mockPostSaveProcessor.afterSaveAsync).toHaveBeenCalledWith({
                requestId: 'user-req-123',
                eventType: 'U',
                resourceType: 'ExportStatus',
                doc: updatedResource
            });
        });

        test('calls mergeResourceAsync with correct parameters', async () => {
            httpContext.get.mockReturnValue('system-req-id');
            const existingResource = { resourceType: 'ExportStatus', id: 'export-1' };
            mockDatabaseExportManager.getExportStatusResourceWithId.mockResolvedValue(existingResource);
            mockResourceMerger.mergeResourceAsync.mockResolvedValue({ updatedResource: null });

            const req = {
                id: 'user-req-123',
                header: jestGlobal.fn(),
                params: { id: 'export-1' },
                headers: {},
                body: { resourceType: 'ExportStatus', status: 'completed' },
                sanitized_args: {},
                query: {}
            };
            const res = {};

            await manager.updateExportStatus({ req, res });

            expect(mockResourceMerger.mergeResourceAsync).toHaveBeenCalledWith({
                base_version: '4_0_0',
                requestInfo: { requestId: 'req-1' },
                currentResource: existingResource,
                resourceToMerge: expect.objectContaining({ resourceType: 'ExportStatus' }),
                smartMerge: false,
                incrementVersion: false
            });
        });

        test('rethrows error from databaseExportManager.updateExportStatusAsync', async () => {
            httpContext.get.mockReturnValue('system-req-id');
            const existingResource = { resourceType: 'ExportStatus', id: 'export-1' };
            const updatedResource = { resourceType: 'ExportStatus', id: 'export-1', status: 'completed' };
            mockDatabaseExportManager.getExportStatusResourceWithId.mockResolvedValue(existingResource);
            mockResourceMerger.mergeResourceAsync.mockResolvedValue({ updatedResource });
            mockDatabaseExportManager.updateExportStatusAsync.mockRejectedValue(
                new Error('Database write failed')
            );

            const req = {
                id: 'user-req-123',
                header: jestGlobal.fn(),
                params: { id: 'export-1' },
                headers: {},
                body: { resourceType: 'ExportStatus', status: 'completed' },
                sanitized_args: {},
                query: {}
            };
            const res = {};

            await expect(manager.updateExportStatus({ req, res })).rejects.toThrow('Database write failed');
        });
    });
});
