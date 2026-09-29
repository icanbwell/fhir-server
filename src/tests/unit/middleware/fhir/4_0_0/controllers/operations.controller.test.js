const { describe, test, expect, jest, beforeEach, afterEach } = require('@jest/globals');

// Mock express-http-context
jest.mock('express-http-context', () => ({
    get: jest.fn(),
    set: jest.fn()
}));

// Mock systemEventLogging to prevent real logging
jest.mock('../../../../../../operations/common/systemEventLogging', () => ({
    logTraceSystemEventAsync: jest.fn().mockResolvedValue(undefined),
    logSystemEventAsync: jest.fn().mockResolvedValue(undefined),
    logSystemErrorAsync: jest.fn().mockResolvedValue(undefined)
}));

// Mock FhirOperationsManager module to avoid transitive dependencies
jest.mock('../../../../../../operations/fhirOperationsManager', () => {
    class FhirOperationsManager {}
    return { FhirOperationsManager };
});

// Mock FhirResponseWriter module to avoid transitive dependencies
jest.mock('../../../../../../middleware/fhir/fhirResponseWriter', () => {
    class FhirResponseWriter {}
    return { FhirResponseWriter };
});

// Mock PostRequestProcessor to avoid transitive dependencies
jest.mock('../../../../../../utils/postRequestProcessor', () => {
    class PostRequestProcessor {}
    return { PostRequestProcessor };
});

const httpContext = require('express-http-context');
const { CustomOperationsController } = require('../../../../../../middleware/fhir/4_0_0/controllers/operations.controller');
const { FhirOperationsManager } = require('../../../../../../operations/fhirOperationsManager');
const { PostRequestProcessor } = require('../../../../../../utils/postRequestProcessor');
const { FhirResponseWriter } = require('../../../../../../middleware/fhir/fhirResponseWriter');
const { RequestSpecificCache } = require('../../../../../../utils/requestSpecificCache');

describe('CustomOperationsController', () => {
    /** @type {CustomOperationsController} */
    let controller;
    /** @type {RequestSpecificCache} */
    let requestSpecificCache;
    let mockPostRequestProcessor;
    let mockFhirOperationsManager;
    let mockFhirResponseWriter;
    let mockReq;
    let mockRes;
    let mockNext;

    const TEST_REQUEST_ID = 'test-request-id-456';

    beforeEach(() => {
        // Use real RequestSpecificCache to test cache behavior
        requestSpecificCache = new RequestSpecificCache();

        // Create mock PostRequestProcessor using Object.create for assertTypeEquals
        mockPostRequestProcessor = Object.create(PostRequestProcessor.prototype);
        mockPostRequestProcessor.executeAsync = jest.fn().mockResolvedValue(undefined);

        // Create mock FhirOperationsManager
        mockFhirOperationsManager = Object.create(FhirOperationsManager.prototype);
        mockFhirOperationsManager.merge = jest.fn().mockResolvedValue({ resourceType: 'Bundle', entry: [] });
        mockFhirOperationsManager.graph = jest.fn().mockResolvedValue({ resourceType: 'Bundle', entry: [] });
        mockFhirOperationsManager.everything = jest.fn().mockResolvedValue({ resourceType: 'Bundle', entry: [] });
        mockFhirOperationsManager.export = jest.fn().mockResolvedValue({ status: 'completed' });
        mockFhirOperationsManager.import = jest.fn().mockResolvedValue({ status: 'completed' });
        mockFhirOperationsManager.exportById = jest.fn().mockResolvedValue({ status: 'completed' });
        mockFhirOperationsManager.summary = jest.fn().mockResolvedValue({ total: 5 });
        mockFhirOperationsManager.validate = jest.fn().mockResolvedValue({ valid: true });
        mockFhirOperationsManager.customOp = jest.fn().mockResolvedValue({ result: 'ok' });

        // Create mock FhirResponseWriter
        mockFhirResponseWriter = Object.create(FhirResponseWriter.prototype);
        mockFhirResponseWriter.merge = jest.fn();
        mockFhirResponseWriter.graph = jest.fn();
        mockFhirResponseWriter.everything = jest.fn();
        mockFhirResponseWriter.export = jest.fn();
        mockFhirResponseWriter.import = jest.fn();
        mockFhirResponseWriter.exportById = jest.fn();
        mockFhirResponseWriter.summary = jest.fn();
        mockFhirResponseWriter.readCustomOperation = jest.fn();

        // Create controller
        controller = new CustomOperationsController({
            postRequestProcessor: mockPostRequestProcessor,
            fhirOperationsManager: mockFhirOperationsManager,
            fhirResponseWriter: mockFhirResponseWriter,
            requestSpecificCache
        });

        // Setup mock request/response/next
        mockReq = {
            sanitized_args: { base_version: '4_0_0', id: 'test-id' },
            body: { resourceType: 'Patient', id: '1' }
        };
        mockRes = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
            set: jest.fn()
        };
        mockNext = jest.fn();

        // Setup httpContext mock
        httpContext.get.mockReturnValue(TEST_REQUEST_ID);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    // ================================================================
    // 9-POINT CACHE ANALYSIS for CustomOperationsController
    // ================================================================
    // 1. All 3 methods (operationsPost, operationsDelete, operationsGet) use try/catch/finally
    // 2. requestSpecificCache.clearAsync is called in `finally` - runs on success + error paths
    // 3. postRequestProcessor.executeAsync is called BEFORE clearAsync in finally
    // 4. The requestId is fetched from httpContext INSIDE the finally block (not captured at start)
    // 5. BUG: If httpContext.get returns null/undefined, clearAsync will throw (assertIsValid)
    // 6. BUG: If postRequestProcessor.executeAsync throws, clearAsync is NEVER called (no nested try)
    //    This causes memory leaks - cache data persists for failed requests
    // 7. operationsPost uses dynamic dispatch: this.fhirOperationsManager[`${name}`]
    //    If `name` doesn't match a method, TypeError is thrown -> caught by catch -> cache IS cleared
    // 8. operationsPost has branching response logic (merge/graph/everything/export/import/default)
    // 9. Same cache-leak pattern as GenericController - systemic issue across both controllers
    // ================================================================

    describe('operationsPost', () => {
        test('should call merge operation and use merge response writer', async () => {
            const handler = controller.operationsPost({ name: 'merge', resourceType: 'Patient' });
            await handler(mockReq, mockRes, mockNext);

            expect(mockFhirOperationsManager.merge).toHaveBeenCalledWith(
                { id: 'test-id', base_version: '4_0_0', resource: mockReq.body },
                { req: mockReq, res: mockRes },
                'Patient'
            );
            expect(mockFhirResponseWriter.merge).toHaveBeenCalledWith({
                req: mockReq,
                res: mockRes,
                result: { resourceType: 'Bundle', entry: [] }
            });
        });

        test('should call graph operation and use graph response writer', async () => {
            const handler = controller.operationsPost({ name: 'graph', resourceType: 'Patient' });
            await handler(mockReq, mockRes, mockNext);

            expect(mockFhirOperationsManager.graph).toHaveBeenCalled();
            expect(mockFhirResponseWriter.graph).toHaveBeenCalledWith({
                req: mockReq,
                res: mockRes,
                result: { resourceType: 'Bundle', entry: [] }
            });
        });

        test('should call everything operation and use everything response writer', async () => {
            const handler = controller.operationsPost({ name: 'everything', resourceType: 'Patient' });
            await handler(mockReq, mockRes, mockNext);

            expect(mockFhirOperationsManager.everything).toHaveBeenCalled();
            expect(mockFhirResponseWriter.everything).toHaveBeenCalledWith({
                req: mockReq,
                res: mockRes,
                result: { resourceType: 'Bundle', entry: [] }
            });
        });

        test('should call export operation and use export response writer', async () => {
            const handler = controller.operationsPost({ name: 'export', resourceType: 'Patient' });
            await handler(mockReq, mockRes, mockNext);

            expect(mockFhirOperationsManager.export).toHaveBeenCalled();
            expect(mockFhirResponseWriter.export).toHaveBeenCalledWith({
                req: mockReq,
                res: mockRes,
                result: { status: 'completed' }
            });
        });

        test('should call import operation and use import response writer', async () => {
            const handler = controller.operationsPost({ name: 'import', resourceType: 'Patient' });
            await handler(mockReq, mockRes, mockNext);

            expect(mockFhirOperationsManager.import).toHaveBeenCalled();
            expect(mockFhirResponseWriter.import).toHaveBeenCalledWith({
                req: mockReq,
                res: mockRes,
                result: { status: 'completed' }
            });
        });

        test('should use readCustomOperation for unknown operation names', async () => {
            const handler = controller.operationsPost({ name: 'customOp', resourceType: 'Patient' });
            await handler(mockReq, mockRes, mockNext);

            expect(mockFhirOperationsManager.customOp).toHaveBeenCalled();
            expect(mockFhirResponseWriter.readCustomOperation).toHaveBeenCalledWith({
                req: mockReq,
                res: mockRes,
                result: { result: 'ok' }
            });
        });

        test('should call next(e) on error and still clear cache', async () => {
            const testError = new Error('merge operation failed');
            mockFhirOperationsManager.merge.mockRejectedValue(testError);

            requestSpecificCache.getMap({ requestId: TEST_REQUEST_ID, name: 'testCache' }).set('key', 'value');

            const handler = controller.operationsPost({ name: 'merge', resourceType: 'Patient' });
            await handler(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalledWith(testError);
            // Cache should be cleared in finally block
            expect(requestSpecificCache.mapCache.has(TEST_REQUEST_ID)).toBe(false);
        });

        test('cache is still cleared if postRequestProcessor.executeAsync throws', async () => {
            const postProcessorError = new Error('post processor failed');
            mockPostRequestProcessor.executeAsync = jest.fn().mockRejectedValue(postProcessorError);

            requestSpecificCache.getMap({ requestId: TEST_REQUEST_ID, name: 'testCache' }).set('key', 'value');

            const handler = controller.operationsPost({ name: 'merge', resourceType: 'Patient' });

            await expect(async () => {
                await handler(mockReq, mockRes, mockNext);
            }).rejects.toThrow('post processor failed');

            // Cache is cleared even though executeAsync threw, since clearAsync now runs in its own finally
            expect(requestSpecificCache.mapCache.has(TEST_REQUEST_ID)).toBe(false);
        });

        test('BUG: when httpContext returns undefined requestId, executeAsync is called with undefined', async () => {
            // In production, postRequestProcessor.executeAsync calls assertIsValid(requestId)
            // which would throw when requestId is undefined. With mocked executeAsync,
            // this passes silently but demonstrates the vulnerability.
            httpContext.get.mockReturnValue(undefined);

            requestSpecificCache.getMap({ requestId: 'other-request', name: 'testCache' }).set('key', 'value');

            const handler = controller.operationsPost({ name: 'merge', resourceType: 'Patient' });
            await handler(mockReq, mockRes, mockNext);

            expect(mockPostRequestProcessor.executeAsync).toHaveBeenCalledWith({ requestId: undefined });
            // Other request's cache is NOT cleared
            expect(requestSpecificCache.mapCache.has('other-request')).toBe(true);
        });

        test('should throw TypeError if operation name does not exist on manager', async () => {
            const handler = controller.operationsPost({ name: 'nonExistentOp', resourceType: 'Patient' });
            await handler(mockReq, mockRes, mockNext);

            // Should call next with the TypeError
            expect(mockNext).toHaveBeenCalled();
            const errorArg = mockNext.mock.calls[0][0];
            expect(errorArg).toBeInstanceOf(TypeError);
        });

        test('should properly extract id, base_version and resource from request', async () => {
            mockReq.sanitized_args = { base_version: '4_0_0', id: 'patient-123', other_param: 'ignored' };
            mockReq.body = { resourceType: 'Parameters', parameter: [] };

            const handler = controller.operationsPost({ name: 'merge', resourceType: 'Patient' });
            await handler(mockReq, mockRes, mockNext);

            expect(mockFhirOperationsManager.merge).toHaveBeenCalledWith(
                { id: 'patient-123', base_version: '4_0_0', resource: { resourceType: 'Parameters', parameter: [] } },
                { req: mockReq, res: mockRes },
                'Patient'
            );
        });
    });

    describe('operationsDelete', () => {
        test('should call operation and use readCustomOperation response writer', async () => {
            mockFhirOperationsManager.removeLinks = jest.fn().mockResolvedValue({ deleted: true });

            const handler = controller.operationsDelete({ name: 'removeLinks', resourceType: 'Patient' });
            await handler(mockReq, mockRes, mockNext);

            expect(mockFhirOperationsManager.removeLinks).toHaveBeenCalledWith(
                { id: 'test-id', base_version: '4_0_0', resource: mockReq.body },
                { req: mockReq, res: mockRes },
                'Patient'
            );
            expect(mockFhirResponseWriter.readCustomOperation).toHaveBeenCalledWith({
                req: mockReq,
                res: mockRes,
                result: { deleted: true }
            });
        });

        test('should call next(e) on error and clear cache', async () => {
            const testError = new Error('delete operation failed');
            mockFhirOperationsManager.removeLinks = jest.fn().mockRejectedValue(testError);

            requestSpecificCache.getMap({ requestId: TEST_REQUEST_ID, name: 'testCache' }).set('key', 'value');

            const handler = controller.operationsDelete({ name: 'removeLinks', resourceType: 'Patient' });
            await handler(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalledWith(testError);
            expect(requestSpecificCache.mapCache.has(TEST_REQUEST_ID)).toBe(false);
        });

        test('cache is still cleared if postRequestProcessor.executeAsync throws in delete', async () => {
            mockFhirOperationsManager.removeLinks = jest.fn().mockResolvedValue({ deleted: true });
            const postProcessorError = new Error('post processor failed in delete');
            mockPostRequestProcessor.executeAsync = jest.fn().mockRejectedValue(postProcessorError);

            requestSpecificCache.getMap({ requestId: TEST_REQUEST_ID, name: 'testCache' }).set('key', 'value');

            const handler = controller.operationsDelete({ name: 'removeLinks', resourceType: 'Patient' });

            await expect(async () => {
                await handler(mockReq, mockRes, mockNext);
            }).rejects.toThrow('post processor failed in delete');

            // Cache is cleared even though executeAsync threw, since clearAsync now runs in its own finally
            expect(requestSpecificCache.mapCache.has(TEST_REQUEST_ID)).toBe(false);
        });
    });

    describe('operationsGet', () => {
        test('should call graph operation and use graph response writer', async () => {
            const handler = controller.operationsGet({ name: 'graph', resourceType: 'Patient' });
            await handler(mockReq, mockRes, mockNext);

            expect(mockFhirOperationsManager.graph).toHaveBeenCalledWith(
                mockReq.sanitized_args,
                { req: mockReq, res: mockRes },
                'Patient'
            );
            expect(mockFhirResponseWriter.graph).toHaveBeenCalledWith({
                req: mockReq,
                res: mockRes,
                result: { resourceType: 'Bundle', entry: [] }
            });
        });

        test('should call everything operation and use everything response writer', async () => {
            const handler = controller.operationsGet({ name: 'everything', resourceType: 'Patient' });
            await handler(mockReq, mockRes, mockNext);

            expect(mockFhirOperationsManager.everything).toHaveBeenCalled();
            expect(mockFhirResponseWriter.everything).toHaveBeenCalled();
        });

        test('should call exportById and use exportById response writer', async () => {
            const handler = controller.operationsGet({ name: 'exportById', resourceType: 'Patient' });
            await handler(mockReq, mockRes, mockNext);

            expect(mockFhirOperationsManager.exportById).toHaveBeenCalled();
            expect(mockFhirResponseWriter.exportById).toHaveBeenCalledWith({
                req: mockReq,
                res: mockRes,
                result: { status: 'completed' }
            });
        });

        test('should call summary and use summary response writer', async () => {
            const handler = controller.operationsGet({ name: 'summary', resourceType: 'Patient' });
            await handler(mockReq, mockRes, mockNext);

            expect(mockFhirOperationsManager.summary).toHaveBeenCalled();
            expect(mockFhirResponseWriter.summary).toHaveBeenCalledWith({
                req: mockReq,
                res: mockRes,
                result: { total: 5 }
            });
        });

        test('should use readCustomOperation for unknown GET operations', async () => {
            const handler = controller.operationsGet({ name: 'customOp', resourceType: 'Patient' });
            await handler(mockReq, mockRes, mockNext);

            expect(mockFhirOperationsManager.customOp).toHaveBeenCalled();
            expect(mockFhirResponseWriter.readCustomOperation).toHaveBeenCalledWith({
                req: mockReq,
                res: mockRes,
                result: { result: 'ok' }
            });
        });

        test('should pass sanitized_args directly (not destructured like POST/DELETE)', async () => {
            mockReq.sanitized_args = { base_version: '4_0_0', id: 'patient-123', _count: 10 };

            const handler = controller.operationsGet({ name: 'customOp', resourceType: 'Patient' });
            await handler(mockReq, mockRes, mockNext);

            // operationsGet passes sanitized_args directly, unlike operationsPost/Delete which destructure
            expect(mockFhirOperationsManager.customOp).toHaveBeenCalledWith(
                { base_version: '4_0_0', id: 'patient-123', _count: 10 },
                { req: mockReq, res: mockRes },
                'Patient'
            );
        });

        test('should call next(e) on error and clear cache', async () => {
            const testError = new Error('get operation failed');
            mockFhirOperationsManager.graph.mockRejectedValue(testError);

            requestSpecificCache.getMap({ requestId: TEST_REQUEST_ID, name: 'testCache' }).set('key', 'value');

            const handler = controller.operationsGet({ name: 'graph', resourceType: 'Patient' });
            await handler(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalledWith(testError);
            expect(requestSpecificCache.mapCache.has(TEST_REQUEST_ID)).toBe(false);
        });

        test('cache is still cleared if postRequestProcessor.executeAsync throws in GET', async () => {
            const postProcessorError = new Error('post processor failed in get');
            mockPostRequestProcessor.executeAsync = jest.fn().mockRejectedValue(postProcessorError);

            requestSpecificCache.getMap({ requestId: TEST_REQUEST_ID, name: 'testCache' }).set('key', 'value');

            const handler = controller.operationsGet({ name: 'graph', resourceType: 'Patient' });

            await expect(async () => {
                await handler(mockReq, mockRes, mockNext);
            }).rejects.toThrow('post processor failed in get');

            // Cache is cleared even though executeAsync threw, since clearAsync now runs in its own finally
            expect(requestSpecificCache.mapCache.has(TEST_REQUEST_ID)).toBe(false);
        });

        test('BUG: when httpContext returns undefined requestId in GET, executeAsync is called with undefined', async () => {
            // In production, postRequestProcessor.executeAsync calls assertIsValid(requestId)
            // which would throw when requestId is undefined. With mocked executeAsync,
            // this passes silently but demonstrates the vulnerability.
            httpContext.get.mockReturnValue(undefined);

            requestSpecificCache.getMap({ requestId: 'other-request', name: 'testCache' }).set('key', 'value');

            const handler = controller.operationsGet({ name: 'graph', resourceType: 'Patient' });
            await handler(mockReq, mockRes, mockNext);

            expect(mockPostRequestProcessor.executeAsync).toHaveBeenCalledWith({ requestId: undefined });
            // Other request's cache is NOT cleared
            expect(requestSpecificCache.mapCache.has('other-request')).toBe(true);
        });
    });
});
