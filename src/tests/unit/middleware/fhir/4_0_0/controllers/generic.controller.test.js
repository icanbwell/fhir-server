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

// Mock ConfigManager to avoid transitive dependencies
jest.mock('../../../../../../utils/configManager', () => {
    class ConfigManager {}
    return { ConfigManager };
});

// Mock PostRequestProcessor to avoid transitive dependencies
jest.mock('../../../../../../utils/postRequestProcessor', () => {
    class PostRequestProcessor {}
    return { PostRequestProcessor };
});

const httpContext = require('express-http-context');
const { GenericController } = require('../../../../../../middleware/fhir/4_0_0/controllers/generic.controller');
const { FhirOperationsManager } = require('../../../../../../operations/fhirOperationsManager');
const { PostRequestProcessor } = require('../../../../../../utils/postRequestProcessor');
const { FhirResponseWriter } = require('../../../../../../middleware/fhir/fhirResponseWriter');
const { ConfigManager } = require('../../../../../../utils/configManager');
const { RequestSpecificCache } = require('../../../../../../utils/requestSpecificCache');

describe('GenericController', () => {
    /** @type {GenericController} */
    let controller;
    /** @type {RequestSpecificCache} */
    let requestSpecificCache;
    let mockPostRequestProcessor;
    let mockFhirOperationsManager;
    let mockFhirResponseWriter;
    let mockConfigManager;
    let mockReq;
    let mockRes;
    let mockNext;

    const TEST_REQUEST_ID = 'test-request-id-123';

    beforeEach(() => {
        // Use real RequestSpecificCache to test cache behavior
        requestSpecificCache = new RequestSpecificCache();

        // Create mock PostRequestProcessor using Object.create for assertTypeEquals
        mockPostRequestProcessor = Object.create(PostRequestProcessor.prototype);
        mockPostRequestProcessor.executeAsync = jest.fn().mockResolvedValue(undefined);

        // Create mock FhirOperationsManager
        mockFhirOperationsManager = Object.create(FhirOperationsManager.prototype);
        mockFhirOperationsManager.search = jest.fn().mockResolvedValue({ resourceType: 'Bundle', entry: [] });
        mockFhirOperationsManager.searchStreaming = jest.fn().mockResolvedValue(undefined);
        mockFhirOperationsManager.searchById = jest.fn().mockResolvedValue({ resourceType: 'Patient', id: '1' });
        mockFhirOperationsManager.searchByVersionId = jest.fn().mockResolvedValue({ resourceType: 'Patient', id: '1' });
        mockFhirOperationsManager.create = jest.fn().mockResolvedValue({ resourceType: 'Patient', id: '1' });
        mockFhirOperationsManager.merge = jest.fn().mockResolvedValue({ resourceType: 'Patient', id: '1' });
        mockFhirOperationsManager.update = jest.fn().mockResolvedValue({ id: '1', created: false, resource_version: '2', resource: {} });
        mockFhirOperationsManager.remove = jest.fn().mockResolvedValue({ deleted: true });
        mockFhirOperationsManager.patch = jest.fn().mockResolvedValue({ id: '1', created: false, resource_version: '2', resource: {} });
        mockFhirOperationsManager.history = jest.fn().mockResolvedValue({ resourceType: 'Bundle', entry: [] });
        mockFhirOperationsManager.historyById = jest.fn().mockResolvedValue({ resourceType: 'Bundle', entry: [] });

        // Create mock FhirResponseWriter
        mockFhirResponseWriter = Object.create(FhirResponseWriter.prototype);
        mockFhirResponseWriter.read = jest.fn();
        mockFhirResponseWriter.readOne = jest.fn();
        mockFhirResponseWriter.create = jest.fn();
        mockFhirResponseWriter.update = jest.fn();
        mockFhirResponseWriter.remove = jest.fn();
        mockFhirResponseWriter.history = jest.fn();

        // Create mock ConfigManager with getter
        mockConfigManager = Object.create(ConfigManager.prototype);
        Object.defineProperty(mockConfigManager, 'streamResponse', {
            get: () => false,
            configurable: true
        });

        // Create controller
        controller = new GenericController({
            postRequestProcessor: mockPostRequestProcessor,
            fhirOperationsManager: mockFhirOperationsManager,
            fhirResponseWriter: mockFhirResponseWriter,
            configManager: mockConfigManager,
            requestSpecificCache
        });

        // Setup mock request/response/next
        mockReq = {
            sanitized_args: { base_version: '4_0_0', id: 'test-id' },
            query: {},
            headers: {}
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
    // 9-POINT CACHE ANALYSIS for GenericController
    // ================================================================
    // 1. All 10 methods use try/catch/finally pattern
    // 2. requestSpecificCache.clearAsync is called in the `finally` block (runs on success + error)
    // 3. postRequestProcessor.executeAsync is called BEFORE clearAsync in finally
    // 4. The requestId is obtained from httpContext INSIDE the finally block (not captured at start)
    // 5. BUG: If httpContext.get returns null/undefined, clearAsync will throw (assertIsValid)
    // 6. BUG: If postRequestProcessor.executeAsync throws, clearAsync is NEVER called (no nested try)
    //    This means cache data leaks in memory if postRequestProcessor fails
    // 7. On normal error paths (operation throws), cache IS properly cleared via finally
    // 8. Stream vs non-stream in search() both go through same finally block (consistent)
    // 9. All methods are identical in their finally pattern - bug is systemic
    // ================================================================

    describe('search', () => {
        test('should call fhirOperationsManager.search and write response for non-streaming', async () => {
            const handler = controller.search({}, 'Patient');
            await handler(mockReq, mockRes, mockNext);

            expect(mockFhirOperationsManager.search).toHaveBeenCalledWith(
                mockReq.sanitized_args,
                { req: mockReq, res: mockRes },
                'Patient'
            );
            expect(mockFhirResponseWriter.read).toHaveBeenCalledWith({
                req: mockReq,
                res: mockRes,
                result: { resourceType: 'Bundle', entry: [] }
            });
        });

        test('should use streaming when configManager.streamResponse is true', async () => {
            Object.defineProperty(mockConfigManager, 'streamResponse', {
                get: () => true,
                configurable: true
            });

            const handler = controller.search({}, 'Patient');
            await handler(mockReq, mockRes, mockNext);

            expect(mockFhirOperationsManager.searchStreaming).toHaveBeenCalledWith(
                mockReq.sanitized_args,
                { req: mockReq, res: mockRes },
                'Patient'
            );
            expect(mockFhirOperationsManager.search).not.toHaveBeenCalled();
        });

        test('should use streaming when req.query._streamResponse is true', async () => {
            mockReq.query._streamResponse = 'true';

            const handler = controller.search({}, 'Patient');
            await handler(mockReq, mockRes, mockNext);

            expect(mockFhirOperationsManager.searchStreaming).toHaveBeenCalled();
            expect(mockFhirOperationsManager.search).not.toHaveBeenCalled();
        });

        test('should call next(e) on error and still clear cache', async () => {
            const testError = new Error('search failed');
            mockFhirOperationsManager.search.mockRejectedValue(testError);

            const handler = controller.search({}, 'Patient');
            await handler(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalledWith(testError);
            expect(mockPostRequestProcessor.executeAsync).toHaveBeenCalledWith({ requestId: TEST_REQUEST_ID });
        });

        test('should clear cache even when operation throws', async () => {
            const testError = new Error('search failed');
            mockFhirOperationsManager.search.mockRejectedValue(testError);

            // Pre-populate the cache to verify it gets cleared
            requestSpecificCache.getMap({ requestId: TEST_REQUEST_ID, name: 'testCache' }).set('key', 'value');
            expect(requestSpecificCache.mapCache.has(TEST_REQUEST_ID)).toBe(true);

            const handler = controller.search({}, 'Patient');
            await handler(mockReq, mockRes, mockNext);

            // Cache should be cleared
            expect(requestSpecificCache.mapCache.has(TEST_REQUEST_ID)).toBe(false);
        });

        test('BUG #13: cache must be cleared even if postRequestProcessor.executeAsync throws', async () => {
            // If postRequestProcessor.executeAsync throws, requestSpecificCache.clearAsync
            // should still be called to prevent memory leaks.
            const postProcessorError = new Error('post processor failed');
            mockPostRequestProcessor.executeAsync = jest.fn().mockRejectedValue(postProcessorError);

            // Pre-populate cache
            requestSpecificCache.getMap({ requestId: TEST_REQUEST_ID, name: 'testCache' }).set('key', 'value');

            const handler = controller.search({}, 'Patient');

            // Even if the handler throws, cache should still be cleared
            try {
                await handler(mockReq, mockRes, mockNext);
            } catch (e) {
                // May or may not throw depending on implementation
            }

            // EXPECTED: correct behavior (will fail until bug is fixed)
            expect(requestSpecificCache.mapCache.has(TEST_REQUEST_ID)).toBe(false);
        });

        test('BUG: when httpContext returns undefined requestId, postRequestProcessor.executeAsync is called with undefined requestId', async () => {
            // When httpContext.get returns undefined, the requestId passed to
            // postRequestProcessor.executeAsync and clearAsync will be undefined.
            // In real code (non-mocked), postRequestProcessor.executeAsync would throw
            // an AssertionError because it calls assertIsValid(requestId).
            // With our mocked executeAsync, this is silent but demonstrates the
            // pattern: requestId is fetched from httpContext in the finally block,
            // which can be undefined if the context was not set up properly.
            httpContext.get.mockReturnValue(undefined);

            // Pre-populate cache with some other request to show it persists
            requestSpecificCache.getMap({ requestId: 'other-request', name: 'testCache' }).set('key', 'value');

            const handler = controller.search({}, 'Patient');
            await handler(mockReq, mockRes, mockNext);

            // executeAsync is called with undefined requestId - in production this would throw
            expect(mockPostRequestProcessor.executeAsync).toHaveBeenCalledWith({ requestId: undefined });
            // The other request's cache is NOT cleared (since clearAsync was called with undefined)
            expect(requestSpecificCache.mapCache.has('other-request')).toBe(true);
        });
    });

    describe('searchById', () => {
        test('should call fhirOperationsManager.searchById and write response', async () => {
            const handler = controller.searchById({}, 'Patient');
            await handler(mockReq, mockRes, mockNext);

            expect(mockFhirOperationsManager.searchById).toHaveBeenCalledWith(
                mockReq.sanitized_args,
                { req: mockReq, res: mockRes },
                'Patient'
            );
            expect(mockFhirResponseWriter.readOne).toHaveBeenCalledWith({
                req: mockReq,
                res: mockRes,
                resource: { resourceType: 'Patient', id: '1' }
            });
        });

        test('should call next on error and clear cache', async () => {
            const testError = new Error('searchById failed');
            mockFhirOperationsManager.searchById.mockRejectedValue(testError);

            // Pre-populate cache
            requestSpecificCache.getMap({ requestId: TEST_REQUEST_ID, name: 'testCache' }).set('key', 'value');

            const handler = controller.searchById({}, 'Patient');
            await handler(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalledWith(testError);
            // Cache should be cleared
            expect(requestSpecificCache.mapCache.has(TEST_REQUEST_ID)).toBe(false);
        });

        test('should call postRequestProcessor.executeAsync before clearing cache', async () => {
            const callOrder = [];
            mockPostRequestProcessor.executeAsync = jest.fn().mockImplementation(async () => {
                callOrder.push('executeAsync');
            });
            // Spy on clearAsync
            const originalClearAsync = requestSpecificCache.clearAsync.bind(requestSpecificCache);
            requestSpecificCache.clearAsync = jest.fn().mockImplementation(async (args) => {
                callOrder.push('clearAsync');
                return originalClearAsync(args);
            });

            const handler = controller.searchById({}, 'Patient');
            await handler(mockReq, mockRes, mockNext);

            expect(callOrder).toEqual(['executeAsync', 'clearAsync']);
        });
    });

    describe('merge', () => {
        test('should call fhirOperationsManager.merge and write response', async () => {
            const handler = controller.merge({}, 'Patient');
            await handler(mockReq, mockRes, mockNext);

            expect(mockFhirOperationsManager.merge).toHaveBeenCalledWith(
                mockReq.sanitized_args,
                { req: mockReq, res: mockRes },
                'Patient'
            );
            expect(mockFhirResponseWriter.create).toHaveBeenCalled();
        });

        test('should NOT write response when accept header is ndjson', async () => {
            mockReq.headers.accept = 'application/fhir+ndjson';

            const handler = controller.merge({}, 'Patient');
            await handler(mockReq, mockRes, mockNext);

            expect(mockFhirOperationsManager.merge).toHaveBeenCalled();
            expect(mockFhirResponseWriter.create).not.toHaveBeenCalled();
        });

        test('should clear cache on error path', async () => {
            const testError = new Error('merge failed');
            mockFhirOperationsManager.merge.mockRejectedValue(testError);

            requestSpecificCache.getMap({ requestId: TEST_REQUEST_ID, name: 'testCache' }).set('key', 'value');

            const handler = controller.merge({}, 'Patient');
            await handler(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalledWith(testError);
            expect(requestSpecificCache.mapCache.has(TEST_REQUEST_ID)).toBe(false);
        });

        test('BUG #13: cache must be cleared even if postRequestProcessor.executeAsync throws during merge', async () => {
            const postProcessorError = new Error('post processor failed in merge');
            mockPostRequestProcessor.executeAsync = jest.fn().mockRejectedValue(postProcessorError);

            requestSpecificCache.getMap({ requestId: TEST_REQUEST_ID, name: 'testCache' }).set('key', 'value');

            const handler = controller.merge({}, 'Patient');

            try {
                await handler(mockReq, mockRes, mockNext);
            } catch (e) {
                // May or may not throw depending on implementation
            }

            // EXPECTED: correct behavior (will fail until bug is fixed)
            expect(requestSpecificCache.mapCache.has(TEST_REQUEST_ID)).toBe(false);
        });
    });

    describe('create', () => {
        test('should call fhirOperationsManager.create and write response', async () => {
            const handler = controller.create({}, 'Patient');
            await handler(mockReq, mockRes, mockNext);

            expect(mockFhirOperationsManager.create).toHaveBeenCalledWith(
                mockReq.sanitized_args,
                { req: mockReq, res: mockRes },
                'Patient'
            );
            expect(mockFhirResponseWriter.create).toHaveBeenCalledWith({
                req: mockReq,
                res: mockRes,
                resource: { resourceType: 'Patient', id: '1' },
                options: { type: 'Patient' }
            });
        });

        test('should clear cache on error', async () => {
            const testError = new Error('create failed');
            mockFhirOperationsManager.create.mockRejectedValue(testError);

            requestSpecificCache.getMap({ requestId: TEST_REQUEST_ID, name: 'testCache' }).set('key', 'value');

            const handler = controller.create({}, 'Patient');
            await handler(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalledWith(testError);
            expect(requestSpecificCache.mapCache.has(TEST_REQUEST_ID)).toBe(false);
        });
    });

    describe('update', () => {
        test('should call fhirOperationsManager.update and write response', async () => {
            const handler = controller.update({}, 'Patient');
            await handler(mockReq, mockRes, mockNext);

            expect(mockFhirOperationsManager.update).toHaveBeenCalledWith(
                mockReq.sanitized_args,
                { req: mockReq, res: mockRes },
                'Patient'
            );
            expect(mockFhirResponseWriter.update).toHaveBeenCalled();
        });

        test('should clear cache on error', async () => {
            const testError = new Error('update failed');
            mockFhirOperationsManager.update.mockRejectedValue(testError);

            requestSpecificCache.getMap({ requestId: TEST_REQUEST_ID, name: 'testCache' }).set('key', 'value');

            const handler = controller.update({}, 'Patient');
            await handler(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalledWith(testError);
            expect(requestSpecificCache.mapCache.has(TEST_REQUEST_ID)).toBe(false);
        });
    });

    describe('remove', () => {
        test('should call fhirOperationsManager.remove and write response', async () => {
            const handler = controller.remove({}, 'Patient');
            await handler(mockReq, mockRes, mockNext);

            expect(mockFhirOperationsManager.remove).toHaveBeenCalledWith(
                mockReq.sanitized_args,
                { req: mockReq, res: mockRes },
                'Patient'
            );
            expect(mockFhirResponseWriter.remove).toHaveBeenCalledWith({
                req: mockReq,
                res: mockRes,
                json: { deleted: true }
            });
        });

        test('should clear cache on error', async () => {
            const testError = new Error('remove failed');
            mockFhirOperationsManager.remove.mockRejectedValue(testError);

            requestSpecificCache.getMap({ requestId: TEST_REQUEST_ID, name: 'testCache' }).set('key', 'value');

            const handler = controller.remove({}, 'Patient');
            await handler(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalledWith(testError);
            expect(requestSpecificCache.mapCache.has(TEST_REQUEST_ID)).toBe(false);
        });
    });

    describe('patch', () => {
        test('should call fhirOperationsManager.patch and write response', async () => {
            const handler = controller.patch({}, 'Patient');
            await handler(mockReq, mockRes, mockNext);

            expect(mockFhirOperationsManager.patch).toHaveBeenCalledWith(
                mockReq.sanitized_args,
                { req: mockReq, res: mockRes },
                'Patient'
            );
            expect(mockFhirResponseWriter.update).toHaveBeenCalled();
        });
    });

    describe('history', () => {
        test('should call fhirOperationsManager.history and write response', async () => {
            const handler = controller.history({}, 'Patient');
            await handler(mockReq, mockRes, mockNext);

            expect(mockFhirOperationsManager.history).toHaveBeenCalledWith(
                mockReq.sanitized_args,
                { req: mockReq, res: mockRes },
                'Patient'
            );
            expect(mockFhirResponseWriter.history).toHaveBeenCalledWith({
                req: mockReq,
                res: mockRes,
                json: { resourceType: 'Bundle', entry: [] }
            });
        });

        test('should clear cache on error', async () => {
            const testError = new Error('history failed');
            mockFhirOperationsManager.history.mockRejectedValue(testError);

            requestSpecificCache.getMap({ requestId: TEST_REQUEST_ID, name: 'testCache' }).set('key', 'value');

            const handler = controller.history({}, 'Patient');
            await handler(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalledWith(testError);
            expect(requestSpecificCache.mapCache.has(TEST_REQUEST_ID)).toBe(false);
        });
    });

    describe('historyById', () => {
        test('should call fhirOperationsManager.historyById and write response', async () => {
            const handler = controller.historyById({}, 'Patient');
            await handler(mockReq, mockRes, mockNext);

            expect(mockFhirOperationsManager.historyById).toHaveBeenCalledWith(
                mockReq.sanitized_args,
                { req: mockReq, res: mockRes },
                'Patient'
            );
            expect(mockFhirResponseWriter.history).toHaveBeenCalledWith({
                req: mockReq,
                res: mockRes,
                json: { resourceType: 'Bundle', entry: [] }
            });
        });

        test('should clear cache on error', async () => {
            const testError = new Error('historyById failed');
            mockFhirOperationsManager.historyById.mockRejectedValue(testError);

            requestSpecificCache.getMap({ requestId: TEST_REQUEST_ID, name: 'testCache' }).set('key', 'value');

            const handler = controller.historyById({}, 'Patient');
            await handler(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalledWith(testError);
            expect(requestSpecificCache.mapCache.has(TEST_REQUEST_ID)).toBe(false);
        });

        test('BUG #13: cache must be cleared even if postRequestProcessor.executeAsync throws during historyById', async () => {
            const postProcessorError = new Error('post processor error');
            mockPostRequestProcessor.executeAsync = jest.fn().mockRejectedValue(postProcessorError);

            requestSpecificCache.getMap({ requestId: TEST_REQUEST_ID, name: 'testCache' }).set('key', 'value');

            const handler = controller.historyById({}, 'Patient');

            try {
                await handler(mockReq, mockRes, mockNext);
            } catch (e) {
                // May or may not throw depending on implementation
            }

            // EXPECTED: correct behavior (will fail until bug is fixed)
            expect(requestSpecificCache.mapCache.has(TEST_REQUEST_ID)).toBe(false);
        });
    });

    describe('searchByVersionId', () => {
        test('should call fhirOperationsManager.searchByVersionId and write response', async () => {
            const handler = controller.searchByVersionId({}, 'Patient');
            await handler(mockReq, mockRes, mockNext);

            expect(mockFhirOperationsManager.searchByVersionId).toHaveBeenCalledWith(
                mockReq.sanitized_args,
                { req: mockReq, res: mockRes },
                'Patient'
            );
            expect(mockFhirResponseWriter.readOne).toHaveBeenCalledWith({
                req: mockReq,
                res: mockRes,
                resource: { resourceType: 'Patient', id: '1' }
            });
        });
    });
});
