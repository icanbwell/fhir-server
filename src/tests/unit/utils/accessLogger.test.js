const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

// Mock express-http-context
jestGlobal.mock('express-http-context', () => ({
    get: jestGlobal.fn(),
    set: jestGlobal.fn()
}));

// Mock the logging module
jestGlobal.mock('../../../operations/common/logging', () => ({
    logError: jestGlobal.fn(),
    logInfo: jestGlobal.fn(),
    logDebug: jestGlobal.fn()
}));

// Mock get_all_args
jestGlobal.mock('../../../operations/common/get_all_args', () => ({
    get_all_args: jestGlobal.fn().mockReturnValue({})
}));

// Mock getCircularReplacer
jestGlobal.mock('../../../utils/getCircularReplacer', () => ({
    getCircularReplacer: jestGlobal.fn().mockReturnValue(null)
}));

// Mock bulkWriteRequestContext
jestGlobal.mock('../../../dataLayer/bulkWriteRequestContext', () => ({
    buildBulkWriteRequestContext: jestGlobal.fn().mockImplementation((requestInfo) => ({
        requestId: requestInfo.requestId
    }))
}));

// Mock FhirOperationsManager to avoid deep dependency chain (k8s/openid-client)
jestGlobal.mock('../../../operations/fhirOperationsManager', () => {
    class FhirOperationsManager {}
    return { FhirOperationsManager };
});

// Mock ScopesManager
jestGlobal.mock('../../../operations/security/scopesManager', () => {
    class ScopesManager {}
    return { ScopesManager };
});

// Mock DatabaseBulkInserter
jestGlobal.mock('../../../dataLayer/databaseBulkInserter', () => {
    const { EventEmitter } = require('events');
    class DatabaseBulkInserter extends EventEmitter {}
    return { DatabaseBulkInserter };
});

// Mock AccessLogClickHouseWriter
jestGlobal.mock('../../../utils/accessLogClickHouseWriter', () => {
    class AccessLogClickHouseWriter {}
    return { AccessLogClickHouseWriter };
});

const httpContext = require('express-http-context');
const { AccessLogger } = require('../../../utils/accessLogger');
const { ScopesManager } = require('../../../operations/security/scopesManager');
const { FhirOperationsManager } = require('../../../operations/fhirOperationsManager');
const { DatabaseBulkInserter } = require('../../../dataLayer/databaseBulkInserter');
const { AccessLogClickHouseWriter } = require('../../../utils/accessLogClickHouseWriter');
const { logError, logInfo } = require('../../../operations/common/logging');

function createMockInstance(ClassType) {
    const instance = Object.create(ClassType.prototype);
    return instance;
}

describe('AccessLogger', () => {
    let accessLogger;
    let mockScopesManager;
    let mockFhirOperationsManager;
    let mockDatabaseBulkInserter;

    beforeEach(() => {
        jestGlobal.clearAllMocks();
        httpContext.get.mockReturnValue('req-id-123');

        mockScopesManager = createMockInstance(ScopesManager);

        mockFhirOperationsManager = createMockInstance(FhirOperationsManager);
        mockFhirOperationsManager.getRequestInfo = jestGlobal.fn().mockReturnValue({
            user: 'user-1',
            remoteIpAddress: '10.0.0.1',
            originalUrl: '/Patient/123',
            method: 'GET',
            scope: 'patient/*.read',
            userRequestId: 'user-req-1',
            requestId: 'system-req-1',
            body: null,
            contentTypeFromHeader: null,
            accept: null
        });
        mockFhirOperationsManager.parseParametersFromBody = jestGlobal.fn().mockImplementation(({ combined_args }) => combined_args);
        mockFhirOperationsManager.getParsedArgsAsync = jestGlobal.fn().mockResolvedValue({
            getRawArgs: () => ({})
        });

        mockDatabaseBulkInserter = createMockInstance(DatabaseBulkInserter);
        mockDatabaseBulkInserter.getOperationForResourceAsync = jestGlobal.fn().mockReturnValue({ op: 'insert' });
        mockDatabaseBulkInserter.executeAsync = jestGlobal.fn().mockResolvedValue([]);

        accessLogger = new AccessLogger({
            scopesManager: mockScopesManager,
            fhirOperationsManager: mockFhirOperationsManager,
            base_version: '4_0_0',
            imageVersion: '1.0.0',
            configManager: {
                enableAccessLogs: true,
                enableAccessLogsMongoDB: true,
                enableAccessLogsClickHouse: false,
                accessLogResultLimit: 1024,
                accessLogRequestBodyLimit: 1024
            },
            databaseBulkInserter: mockDatabaseBulkInserter,
            accessLogClickHouseWriter: null
        });
    });

    // =====================================================
    // Tests for logAccessLogAsync
    // =====================================================
    describe('logAccessLogAsync', () => {
        test('should skip when enableAccessLogs is false', async () => {
            accessLogger.enableAccessLogs = false;
            const req = { resourceType: 'Patient', method: 'GET', url: '/Patient', headers: {} };
            await accessLogger.logAccessLogAsync({
                req, statusCode: 200, startTime: Date.now() - 100
            });
            expect(accessLogger.queue).toHaveLength(0);
        });

        test('should skip when no resourceType and statusCode is not 401', async () => {
            const req = { method: 'GET', url: '/', headers: {} };
            await accessLogger.logAccessLogAsync({
                req, statusCode: 200, startTime: Date.now() - 100
            });
            expect(accessLogger.queue).toHaveLength(0);
        });

        test('should NOT skip when statusCode is 401 even without resourceType', async () => {
            const req = { method: 'GET', url: '/', headers: {} };
            mockFhirOperationsManager.getRequestInfo.mockReturnValue({
                user: 'user-1',
                remoteIpAddress: '10.0.0.1',
                originalUrl: '/',
                method: 'GET',
                scope: null,
                userRequestId: 'user-req-1',
                body: null,
                contentTypeFromHeader: null,
                accept: null
            });
            await accessLogger.logAccessLogAsync({
                req, statusCode: 401, startTime: Date.now() - 100
            });
            expect(accessLogger.queue).toHaveLength(1);
        });

        test('should extract resourceType from URL when not in req', async () => {
            const req = { method: 'GET', url: '/4_0_0/Patient?name=test', headers: {} };
            await accessLogger.logAccessLogAsync({
                req, statusCode: 200, startTime: Date.now() - 100
            });
            expect(accessLogger.queue).toHaveLength(1);
        });

        test('should set operation to READ for GET requests', async () => {
            const req = { resourceType: 'Patient', method: 'GET', url: '/Patient', headers: {} };
            await accessLogger.logAccessLogAsync({
                req, statusCode: 200, startTime: Date.now() - 100
            });
            expect(accessLogger.queue[0].doc.request.operation).toBe('READ');
        });

        test('should set operation to READ for $graph POST', async () => {
            const req = { resourceType: 'Patient', method: 'POST', url: '/Patient/$graph', headers: {} };
            await accessLogger.logAccessLogAsync({
                req, statusCode: 200, startTime: Date.now() - 100
            });
            expect(accessLogger.queue[0].doc.request.operation).toBe('READ');
        });

        test('should set operation to WRITE for other POST requests', async () => {
            const req = { resourceType: 'Patient', method: 'POST', url: '/Patient', headers: {} };
            await accessLogger.logAccessLogAsync({
                req, statusCode: 200, startTime: Date.now() - 100
            });
            expect(accessLogger.queue[0].doc.request.operation).toBe('WRITE');
        });

        test('should truncate operationResult exceeding limit', async () => {
            const req = { resourceType: 'Patient', method: 'GET', url: '/Patient', headers: {} };
            const largeResult = [{ data: 'x'.repeat(2000) }];
            await accessLogger.logAccessLogAsync({
                req, statusCode: 200, startTime: Date.now() - 100, operationResult: largeResult
            });
            expect(accessLogger.queue[0].doc.details.operationResultTruncated).toBe('true');
            expect(logInfo).toHaveBeenCalledWith(expect.stringContaining('operationResult truncated'));
        });

        test('should not truncate small operationResult', async () => {
            const req = { resourceType: 'Patient', method: 'GET', url: '/Patient', headers: {} };
            const smallResult = [{ data: 'ok' }];
            await accessLogger.logAccessLogAsync({
                req, statusCode: 200, startTime: Date.now() - 100, operationResult: smallResult
            });
            expect(accessLogger.queue[0].doc.details.operationResultTruncated).toBeUndefined();
        });

        test('should handle request body from rawBodyBuffer', async () => {
            mockFhirOperationsManager.getRequestInfo.mockReturnValue({
                user: 'user-1',
                remoteIpAddress: '10.0.0.1',
                originalUrl: '/Patient',
                method: 'POST',
                scope: null,
                userRequestId: 'user-req-1',
                body: { resourceType: 'Patient' },
                contentTypeFromHeader: null,
                accept: null
            });
            const req = {
                resourceType: 'Patient',
                method: 'POST',
                url: '/Patient',
                headers: {},
                rawBodyBuffer: Buffer.from('{"resourceType":"Patient"}')
            };
            await accessLogger.logAccessLogAsync({
                req, statusCode: 200, startTime: Date.now() - 100
            });
            expect(accessLogger.queue[0].doc.details.body).toBe('{"resourceType":"Patient"}');
        });

        test('should truncate large rawBodyBuffer', async () => {
            mockFhirOperationsManager.getRequestInfo.mockReturnValue({
                user: 'user-1',
                remoteIpAddress: '10.0.0.1',
                originalUrl: '/Patient',
                method: 'POST',
                scope: null,
                userRequestId: 'user-req-1',
                body: { resourceType: 'Patient' },
                contentTypeFromHeader: null,
                accept: null
            });
            const largeBuffer = Buffer.alloc(2000, 'x');
            const req = {
                resourceType: 'Patient',
                method: 'POST',
                url: '/Patient',
                headers: {},
                rawBodyBuffer: largeBuffer
            };
            await accessLogger.logAccessLogAsync({
                req, statusCode: 200, startTime: Date.now() - 100
            });
            expect(accessLogger.queue[0].doc.details.bodyTruncated).toBe('true');
        });

        test('should use streamRequestBody when provided', async () => {
            mockFhirOperationsManager.getRequestInfo.mockReturnValue({
                user: 'user-1',
                remoteIpAddress: '10.0.0.1',
                originalUrl: '/Patient',
                method: 'POST',
                scope: null,
                userRequestId: 'user-req-1',
                body: 'stream-body-content',
                contentTypeFromHeader: null,
                accept: null
            });
            const req = {
                resourceType: 'Patient',
                method: 'POST',
                url: '/Patient',
                headers: {}
            };
            await accessLogger.logAccessLogAsync({
                req, statusCode: 200, startTime: Date.now() - 100,
                streamRequestBody: 'ndjson-data'
            });
            expect(accessLogger.queue[0].doc.details.body).toBe('ndjson-data');
        });

        test('should include origin-service header in details', async () => {
            const req = {
                resourceType: 'Patient',
                method: 'GET',
                url: '/Patient',
                headers: { 'origin-service': 'my-service' }
            };
            await accessLogger.logAccessLogAsync({
                req, statusCode: 200, startTime: Date.now() - 100
            });
            expect(accessLogger.queue[0].doc.details.originService).toBe('my-service');
        });

        test('should include requestInfo in queue entry when mongoEnabled is true', async () => {
            const req = { resourceType: 'Patient', method: 'GET', url: '/Patient', headers: {} };
            await accessLogger.logAccessLogAsync({
                req, statusCode: 200, startTime: Date.now() - 100
            });
            expect(accessLogger.queue[0].requestInfo).toBeDefined();
            expect(accessLogger.queue[0].requestInfo.requestId).toBeDefined();
        });

        test('should NOT include requestInfo when mongoEnabled is false', async () => {
            accessLogger.mongoEnabled = false;
            const req = { resourceType: 'Patient', method: 'GET', url: '/Patient', headers: {} };
            await accessLogger.logAccessLogAsync({
                req, statusCode: 200, startTime: Date.now() - 100
            });
            expect(accessLogger.queue[0].requestInfo).toBeUndefined();
        });

        // BUG TEST: startTime null leads to NaN duration and Invalid Date
        test('BUG: null startTime produces NaN duration and Invalid Date in request.start', async () => {
            const req = { resourceType: 'Patient', method: 'GET', url: '/Patient', headers: {} };
            await accessLogger.logAccessLogAsync({
                req, statusCode: 200, startTime: null
            });
            const entry = accessLogger.queue[0].doc;
            // new Date(null).toISOString() = '1970-01-01T00:00:00.000Z' (epoch)
            // stopTime - null = stopTime (null coerces to 0)
            // This is misleading - duration will be the stopTime value itself (milliseconds since epoch)
            expect(entry.request.start).toBe('1970-01-01T00:00:00.000Z');
            expect(entry.request.duration).toBeGreaterThan(1000000000000); // epoch ms, clearly wrong
        });

        test('should set outcomeDesc correctly', async () => {
            const req = { resourceType: 'Patient', method: 'GET', url: '/Patient', headers: {} };
            await accessLogger.logAccessLogAsync({
                req, statusCode: 200, startTime: Date.now() - 100
            });
            expect(accessLogger.queue[0].doc.outcomeDesc).toBe('Success');

            accessLogger.queue = [];
            await accessLogger.logAccessLogAsync({
                req, statusCode: 500, startTime: Date.now() - 100
            });
            expect(accessLogger.queue[0].doc.outcomeDesc).toBe('Error');
        });
    });

    // =====================================================
    // Tests for flushAsync
    // =====================================================
    describe('flushAsync', () => {
        test('should do nothing when queue is empty', async () => {
            await accessLogger.flushAsync();
            expect(mockDatabaseBulkInserter.executeAsync).not.toHaveBeenCalled();
        });

        test('should flush queue and call executeAsync', async () => {
            accessLogger.queue = [
                { doc: { timestamp: new Date() }, requestInfo: { requestId: 'r1' } },
                { doc: { timestamp: new Date() }, requestInfo: { requestId: 'r2' } }
            ];
            await accessLogger.flushAsync();
            expect(mockDatabaseBulkInserter.executeAsync).toHaveBeenCalledTimes(1);
            expect(accessLogger.queue).toHaveLength(0);
        });

        test('should log error when mergeResults have issues', async () => {
            mockDatabaseBulkInserter.executeAsync.mockResolvedValue([
                { issue: 'write error' }
            ]);
            accessLogger.queue = [
                { doc: { timestamp: new Date() }, requestInfo: { requestId: 'r1' } }
            ];
            await accessLogger.flushAsync();
            expect(logError).toHaveBeenCalledWith(
                'Error creating access-log entries',
                expect.objectContaining({ source: 'flushAsync' })
            );
        });

        // BUG TEST: executeAsync returns null/undefined - crashes on .filter()
        test('BUG: flushAsync crashes when executeAsync returns null', async () => {
            mockDatabaseBulkInserter.executeAsync.mockResolvedValue(null);
            accessLogger.queue = [
                { doc: { timestamp: new Date() }, requestInfo: { requestId: 'r1' } }
            ];
            // Line 342: `const mergeResultErrors = mergeResults.filter((m) => m.issue);`
            // If mergeResults is null, calling .filter() throws TypeError
            await expect(accessLogger.flushAsync()).rejects.toThrow();
        });

        // BUG TEST: executeAsync returns undefined
        test('BUG: flushAsync crashes when executeAsync returns undefined', async () => {
            mockDatabaseBulkInserter.executeAsync.mockResolvedValue(undefined);
            accessLogger.queue = [
                { doc: { timestamp: new Date() }, requestInfo: { requestId: 'r1' } }
            ];
            await expect(accessLogger.flushAsync()).rejects.toThrow();
        });

        // BUG TEST: When clickhouse only mode, queue entries have no requestInfo
        test('should not crash when only clickHouse is enabled and entries have no requestInfo', async () => {
            const mockClickHouseWriter = createMockInstance(AccessLogClickHouseWriter);
            mockClickHouseWriter.writeBatchAsync = jestGlobal.fn().mockResolvedValue(undefined);

            const clickHouseLogger = new AccessLogger({
                scopesManager: mockScopesManager,
                fhirOperationsManager: mockFhirOperationsManager,
                base_version: '4_0_0',
                imageVersion: '1.0.0',
                configManager: {
                    enableAccessLogs: true,
                    enableAccessLogsMongoDB: false,
                    enableAccessLogsClickHouse: true,
                    accessLogResultLimit: 1024,
                    accessLogRequestBodyLimit: 1024
                },
                databaseBulkInserter: mockDatabaseBulkInserter,
                accessLogClickHouseWriter: mockClickHouseWriter
            });
            clickHouseLogger.mongoEnabled = false;
            clickHouseLogger.clickHouseEnabled = true;

            clickHouseLogger.queue = [
                { doc: { timestamp: new Date() } }  // No requestInfo since mongoEnabled was false
            ];

            // Should not crash - clickHouse path only uses doc
            await clickHouseLogger.flushAsync();
            expect(mockClickHouseWriter.writeBatchAsync).toHaveBeenCalledWith([
                expect.objectContaining({ timestamp: expect.any(Date) })
            ]);
        });

        // BUG TEST: When both mongo and clickhouse are enabled but entry.requestInfo is accessed
        // in mongo path after queue was created with mongoEnabled=false
        test('BUG: requestInfo undefined when mongoEnabled toggled after queue push', async () => {
            // Simulate: entry pushed when mongoEnabled was false (no requestInfo),
            // then mongoEnabled becomes true before flush
            accessLogger.mongoEnabled = false;
            accessLogger.queue = [
                { doc: { timestamp: new Date() } }  // no requestInfo
            ];
            // Now flip to mongo enabled before flush
            accessLogger.mongoEnabled = true;

            // Line 304: entry.requestInfo.requestId will crash since requestInfo is undefined
            await expect(accessLogger.flushAsync()).rejects.toThrow();
        });
    });
});
