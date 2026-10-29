/**
 * Unit tests for AdminExportManager
 * Focuses on: update validation and authorization, serializer use, request id handling
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
        async fastMergeResourceAsync() { return { updatedResource: null }; }
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
        isAccessToResourceAllowedByAccessScopes() { return true; }
        isAccessTagChangeAllowedByAccessScopes() { return true; }
    }
    return { ScopesValidator };
});

jestGlobal.mock('../../../operations/common/resourceValidator', () => {
    class ResourceValidator {
        validateResourceMetaSync() { return null; }
    }
    return { ResourceValidator };
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
        serialize: jestGlobal.fn((obj) => obj)
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
const { ResourceValidator } = require('../../../operations/common/resourceValidator');
const BaseSerializer = require('../../../fhir/writeSerializers/4_0_0/customSerializers/baseSerializer');

BaseSerializer.setConfigManager({ preSaveCodingIdUpdateResources: [] });

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
    let mockResourceValidator;

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
        mockResourceMerger.fastMergeResourceAsync = jestGlobal.fn().mockResolvedValue({ updatedResource: null });

        mockConfigManager = createMockInstance(ConfigManager);
        mockK8sClient = createMockInstance(K8sClient);

        mockExportManager = createMockInstance(ExportManager);
        mockExportManager.triggerExportJob = jestGlobal.fn().mockResolvedValue({ status: 'triggered' });

        mockScopesValidator = createMockInstance(ScopesValidator);
        mockScopesValidator.verifyHasValidScopesAsync = jestGlobal.fn().mockResolvedValue(undefined);
        mockScopesValidator.isAccessToResourceAllowedByAccessScopes = jestGlobal.fn().mockReturnValue(true);
        mockScopesValidator.isAccessTagChangeAllowedByAccessScopes = jestGlobal.fn().mockReturnValue(true);

        mockResourceValidator = createMockInstance(ResourceValidator);
        mockResourceValidator.validateResourceMetaSync = jestGlobal.fn().mockReturnValue(null);

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
            bulkExportEventProducer: mockBulkExportEventProducer,
            resourceValidator: mockResourceValidator
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

        test('serializes the found resource in place and returns it', async () => {
            httpContext.get.mockReturnValue('system-req-id');
            const mockResource = { resourceType: 'ExportStatus', id: 'test-1', status: 'completed' };
            mockFhirOperationsManager.searchById.mockResolvedValue(mockResource);
            const req = { id: 'user-req-123', header: jestGlobal.fn(), params: { id: 'export-1' } };

            const result = await manager.getExportStatus({ req, res: {} });

            expect(FhirResourceSerializer.serialize).toHaveBeenCalledWith(mockResource);
            expect(result).toBe(mockResource);
        });

        test('serializes the search bundle in place and returns it', async () => {
            httpContext.get.mockReturnValue('system-req-id');
            const mockBundle = { resourceType: 'Bundle', entry: [{ resource: { id: '1' } }] };
            mockFhirOperationsManager.search.mockResolvedValue(mockBundle);
            const req = { id: 'user-req-123', header: jestGlobal.fn(), params: {} };

            const result = await manager.getExportStatus({ req, res: {} });

            expect(FhirResourceSerializer.serialize).toHaveBeenCalledWith(mockBundle);
            expect(result).toBe(mockBundle);
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

        test('returns exportResource when the merge returns null updatedResource', async () => {
            httpContext.get.mockReturnValue('system-req-id');
            const existingResource = { resourceType: 'ExportStatus', id: 'export-1', status: 'in-progress' };
            mockDatabaseExportManager.getExportStatusResourceWithId.mockResolvedValue(existingResource);
            mockResourceMerger.fastMergeResourceAsync.mockResolvedValue({ updatedResource: null });

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

            // When updatedResource is null/falsy, returns the exportResource (normalized request body)
            expect(result.resourceType).toBe('ExportStatus');
            expect(mockDatabaseExportManager.updateExportStatusAsync).not.toHaveBeenCalled();
        });

        test('updates and returns updatedResource when merge produces changes', async () => {
            httpContext.get.mockReturnValue('system-req-id');
            const existingResource = { resourceType: 'ExportStatus', id: 'export-1', status: 'in-progress' };
            const updatedResource = { resourceType: 'ExportStatus', id: 'export-1', status: 'completed' };
            mockDatabaseExportManager.getExportStatusResourceWithId.mockResolvedValue(existingResource);
            mockResourceMerger.fastMergeResourceAsync.mockResolvedValue({ updatedResource });

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

            expect(result).toStrictEqual({
                resourceType: 'ExportStatus',
                id: 'export-1',
                status: 'completed',
                output: [],
                errors: []
            });
            expect(result).not.toBe(updatedResource);
            expect(mockDatabaseExportManager.updateExportStatusAsync).toHaveBeenCalledWith({
                exportStatusResource: updatedResource
            });
            expect(mockPostRequestProcessor.add).toHaveBeenCalled();
            expect(mockBulkExportEventProducer.produce).toHaveBeenCalledWith({
                resource: updatedResource,
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

        test('triggerExportJob cleans up the post-request queue and cache in a finally block', async () => {
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

        test('asks for the u letter', async () => {
            httpContext.get.mockReturnValue('system-req-id');
            mockScopesValidator.verifyHasValidScopesAsync.mockRejectedValue(new Error('Insufficient scopes'));

            const req = {
                id: 'user-req-123',
                header: jestGlobal.fn(),
                params: { id: 'export-1' },
                headers: {},
                sanitized_args: {},
                query: {}
            };

            await expect(manager.triggerExportJob({ req, res: {} })).rejects.toThrow('Insufficient scopes');
            expect(mockScopesValidator.verifyHasValidScopesAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    resourceType: 'ExportStatus',
                    action: 'triggerExportJob',
                    accessRequested: 'u'
                })
            );
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

        test('asks for the u letter', async () => {
            httpContext.get.mockReturnValue('system-req-id');
            mockScopesValidator.verifyHasValidScopesAsync.mockRejectedValue(new Error('Access denied'));

            const req = {
                id: 'user-req-123',
                header: jestGlobal.fn(),
                params: { id: 'export-1' },
                headers: {},
                body: { resourceType: 'ExportStatus' },
                sanitized_args: {},
                query: {}
            };

            await expect(manager.updateExportStatus({ req, res: {} })).rejects.toThrow('Access denied');
            expect(mockScopesValidator.verifyHasValidScopesAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    resourceType: 'ExportStatus',
                    action: 'updateExportStatus',
                    accessRequested: 'u'
                })
            );
        });

        test('queues the after-save task under the request id the post-request queue is executed for', async () => {
            httpContext.get.mockReturnValue('system-req-id');
            const existingResource = { resourceType: 'ExportStatus', id: 'export-1', status: 'in-progress' };
            const updatedResource = { resourceType: 'ExportStatus', id: 'export-1', status: 'completed' };
            mockDatabaseExportManager.getExportStatusResourceWithId.mockResolvedValue(existingResource);
            mockResourceMerger.fastMergeResourceAsync.mockResolvedValue({ updatedResource });

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
            expect(addCall.requestId).toBe('req-1');
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

        test('calls fastMergeResourceAsync with correct parameters', async () => {
            httpContext.get.mockReturnValue('system-req-id');
            const existingResource = { resourceType: 'ExportStatus', id: 'export-1' };
            mockDatabaseExportManager.getExportStatusResourceWithId.mockResolvedValue(existingResource);
            mockResourceMerger.fastMergeResourceAsync.mockResolvedValue({ updatedResource: null });

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

            expect(mockResourceMerger.fastMergeResourceAsync).toHaveBeenCalledWith({
                base_version: '4_0_0',
                requestInfo: { requestId: 'req-1' },
                currentResource: existingResource,
                resourceToMerge: expect.objectContaining({ resourceType: 'ExportStatus' }),
                smartMerge: false,
                incrementVersion: false
            });
        });

        test('rejects a body that fails meta validation without merging or saving', async () => {
            httpContext.get.mockReturnValue('system-req-id');
            mockDatabaseExportManager.getExportStatusResourceWithId.mockResolvedValue(
                { resourceType: 'ExportStatus', id: 'export-1' }
            );
            mockResourceValidator.validateResourceMetaSync.mockReturnValue({ resourceType: 'OperationOutcome' });
            const req = {
                id: 'user-req-123',
                header: jestGlobal.fn(),
                params: { id: 'export-1' },
                headers: {},
                body: { resourceType: 'ExportStatus', status: 'completed' },
                sanitized_args: {},
                query: {}
            };

            await expect(manager.updateExportStatus({ req, res: {} })).rejects.toMatchObject({
                message: 'Validation Failed',
                statusCode: 400
            });

            expect(mockResourceMerger.fastMergeResourceAsync).not.toHaveBeenCalled();
            expect(mockDatabaseExportManager.updateExportStatusAsync).not.toHaveBeenCalled();
        });

        test('checks the caller can write the stored resource before merging', async () => {
            httpContext.get.mockReturnValue('system-req-id');
            const existingResource = { resourceType: 'ExportStatus', id: 'export-1' };
            mockDatabaseExportManager.getExportStatusResourceWithId.mockResolvedValue(existingResource);
            mockScopesValidator.isAccessToResourceAllowedByAccessScopes.mockImplementation(() => {
                throw new Error('Forbidden');
            });
            const req = {
                id: 'user-req-123',
                header: jestGlobal.fn(),
                params: { id: 'export-1' },
                headers: {},
                body: { resourceType: 'ExportStatus', status: 'completed' },
                sanitized_args: {},
                query: {}
            };

            await expect(manager.updateExportStatus({ req, res: {} })).rejects.toThrow('Forbidden');

            expect(mockScopesValidator.isAccessToResourceAllowedByAccessScopes).toHaveBeenCalledWith({
                requestInfo: { requestId: 'req-1' },
                resource: existingResource,
                accessRequested: 'write'
            });
            expect(mockResourceMerger.fastMergeResourceAsync).not.toHaveBeenCalled();
        });

        test('checks the merged resource does not re-tag the access tags before saving', async () => {
            httpContext.get.mockReturnValue('system-req-id');
            const existingResource = { resourceType: 'ExportStatus', id: 'export-1' };
            const updatedResource = { resourceType: 'ExportStatus', id: 'export-1', status: 'completed' };
            mockDatabaseExportManager.getExportStatusResourceWithId.mockResolvedValue(existingResource);
            mockResourceMerger.fastMergeResourceAsync.mockResolvedValue({ updatedResource });
            mockScopesValidator.isAccessTagChangeAllowedByAccessScopes.mockImplementation(() => {
                throw new Error('Tag change forbidden');
            });
            const req = {
                id: 'user-req-123',
                header: jestGlobal.fn(),
                params: { id: 'export-1' },
                headers: {},
                body: { resourceType: 'ExportStatus', status: 'completed' },
                sanitized_args: {},
                query: {}
            };

            await expect(manager.updateExportStatus({ req, res: {} })).rejects.toThrow('Tag change forbidden');

            expect(mockScopesValidator.isAccessTagChangeAllowedByAccessScopes).toHaveBeenCalledWith({
                requestInfo: { requestId: 'req-1' },
                currentResource: existingResource,
                updatedResource
            });
            expect(mockDatabaseExportManager.updateExportStatusAsync).not.toHaveBeenCalled();
        });

        test('merges a body that cannot change request and defaults meta.source to the stored one', async () => {
            httpContext.get.mockReturnValue('system-req-id');
            const existingResource = {
                resourceType: 'ExportStatus',
                id: 'export-1',
                request: 'https://example.com/4_0_0/$export',
                meta: { source: 'https://example.com/source' }
            };
            mockDatabaseExportManager.getExportStatusResourceWithId.mockResolvedValue(existingResource);
            const req = {
                id: 'user-req-123',
                header: jestGlobal.fn(),
                params: { id: 'export-1' },
                headers: {},
                body: {
                    resourceType: 'ExportStatus',
                    request: 'https://attacker.example.com/',
                    meta: { security: [{ system: 'https://www.icanbwell.com/owner', code: 'bwell' }] }
                },
                sanitized_args: {},
                query: {}
            };

            await manager.updateExportStatus({ req, res: {} });

            const { resourceToMerge } = mockResourceMerger.fastMergeResourceAsync.mock.calls[0][0];
            expect(resourceToMerge.request).toStrictEqual('https://example.com/4_0_0/$export');
            expect(resourceToMerge.meta.source).toStrictEqual('https://example.com/source');
            expect(mockResourceValidator.validateResourceMetaSync).toHaveBeenCalledWith(resourceToMerge);
        });

        test('rethrows error from databaseExportManager.updateExportStatusAsync', async () => {
            httpContext.get.mockReturnValue('system-req-id');
            const existingResource = { resourceType: 'ExportStatus', id: 'export-1' };
            const updatedResource = { resourceType: 'ExportStatus', id: 'export-1', status: 'completed' };
            mockDatabaseExportManager.getExportStatusResourceWithId.mockResolvedValue(existingResource);
            mockResourceMerger.fastMergeResourceAsync.mockResolvedValue({ updatedResource });
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
