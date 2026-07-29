const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

// Mock express-http-context
jestGlobal.mock('express-http-context', () => ({
    get: jestGlobal.fn(),
    set: jestGlobal.fn()
}));

// Mock the logging module
jestGlobal.mock('../../../operations/common/logging', () => ({
    logError: jestGlobal.fn(),
    logInfo: jestGlobal.fn()
}));

// Mock uid.util
jestGlobal.mock('../../../utils/uid.util', () => ({
    generateUUID: jestGlobal.fn().mockReturnValue('test-uuid-123')
}));

// Mock FhirResourceWriteSerializer
jestGlobal.mock('../../../fhir/fhirResourceWriteSerializer', () => ({
    FhirResourceWriteSerializer: {
        serialize: jestGlobal.fn().mockImplementation(({ obj }) => obj)
    }
}));

// Mock bulkWriteRequestContext
jestGlobal.mock('../../../dataLayer/bulkWriteRequestContext', () => ({
    buildBulkWriteRequestContext: jestGlobal.fn().mockImplementation((requestInfo) => ({
        requestId: requestInfo.requestId
    }))
}));

const { AuditLogger } = require('../../../utils/auditLogger');
const { PostRequestProcessor } = require('../../../utils/postRequestProcessor');
const { PreSaveManager } = require('../../../preSaveHandlers/preSave');
const { ConfigManager } = require('../../../utils/configManager');
const { logError } = require('../../../operations/common/logging');

// Create mock instances that pass assertTypeEquals
function createMockInstance(ClassType) {
    const instance = Object.create(ClassType.prototype);
    return instance;
}

describe('AuditLogger', () => {
    let auditLogger;
    let mockPostRequestProcessor;
    let mockDatabaseBulkInserter;
    let mockPreSaveManager;
    let mockConfigManager;

    beforeEach(() => {
        mockPostRequestProcessor = createMockInstance(PostRequestProcessor);

        mockDatabaseBulkInserter = {
            getOperationForResourceAsync: jestGlobal.fn().mockReturnValue({ op: 'insert' }),
            executeAsync: jestGlobal.fn().mockResolvedValue([])
        };

        mockPreSaveManager = createMockInstance(PreSaveManager);
        mockPreSaveManager.preSaveAsync = jestGlobal.fn().mockImplementation(({ resource }) => resource);

        mockConfigManager = createMockInstance(ConfigManager);
        Object.defineProperty(mockConfigManager, 'maxIdsPerAuditEvent', { get: () => 1000, configurable: true });
        Object.defineProperty(mockConfigManager, 'enableAccessAuditEvent', { get: () => true, configurable: true });
        Object.defineProperty(mockConfigManager, 'auditEventObserverOrganizationId', { get: () => 'org-123', configurable: true });

        auditLogger = new AuditLogger({
            postRequestProcessor: mockPostRequestProcessor,
            databaseBulkInserter: mockDatabaseBulkInserter,
            preSaveManager: mockPreSaveManager,
            configManager: mockConfigManager,
            base_version: '4_0_0'
        });
    });

    // =====================================================
    // Tests for buildAgents
    // =====================================================
    describe('buildAgents', () => {
        test('should build agent for regular user', () => {
            const requestInfo = {
                isUser: true,
                user: 'patient-1',
                alternateUserId: 'alt-1',
                remoteIpAddress: '192.168.1.1',
                actor: {}
            };
            const agents = auditLogger.buildAgents(requestInfo);
            expect(agents).toHaveLength(1);
            expect(agents[0].who.reference).toBe('Patient/person.patient-1');
            expect(agents[0].requestor).toBe(true);
        });

        test('should build agents for delegated user', () => {
            const requestInfo = {
                isUser: true,
                user: 'patient-1',
                userType: 'delegatedUser',
                alternateUserId: 'alt-1',
                remoteIpAddress: '192.168.1.1',
                actor: {
                    reference: 'Practitioner/pract-1',
                    sub: 'sub-1',
                    consentPolicy: 'http://example.com/consent'
                }
            };
            const agents = auditLogger.buildAgents(requestInfo);
            expect(agents).toHaveLength(2);
            expect(agents[0].requestor).toBe(false);
            expect(agents[1].requestor).toBe(true);
            expect(agents[1].who.reference).toBe('Practitioner/pract-1');
            expect(agents[1].policy).toEqual(['http://example.com/consent']);
        });

        test('should handle null requestInfo gracefully with optional chaining', () => {
            const requestInfo = {};
            const agents = auditLogger.buildAgents(requestInfo);
            expect(agents).toHaveLength(1);
            expect(agents[0].who).toBeUndefined();
        });

        // BUG TEST: accessing requestInfo.actor.consentPolicy when actor is undefined
        test('BUG: accessing actor.consentPolicy when actor is null/undefined in non-delegated path', () => {
            const requestInfo = {
                isUser: true,
                user: 'patient-1',
                alternateUserId: 'alt-1',
                remoteIpAddress: '192.168.1.1',
                actor: null
            };
            // Line 98: `const consentPolicy = requestInfo.actor?.consentPolicy;`
            // This uses optional chaining so it should not crash. Confirming.
            const agents = auditLogger.buildAgents(requestInfo);
            expect(agents).toHaveLength(1);
            expect(agents[0].policy).toBeUndefined();
        });

        // BUG TEST: delegatedUser path with null actor
        test('BUG: delegatedUser with null actor causes crash', () => {
            const requestInfo = {
                isUser: true,
                user: 'patient-1',
                userType: 'delegatedUser',
                alternateUserId: 'alt-1',
                remoteIpAddress: '192.168.1.1',
                actor: null
            };
            // Line 77: `const consentPolicy = requestInfo.actor.consentPolicy;`
            // No optional chaining here! Accessing .consentPolicy on null throws.
            expect(() => auditLogger.buildAgents(requestInfo)).toThrow();
        });
    });

    // =====================================================
    // Tests for _buildEntityDetail
    // =====================================================
    describe('_buildEntityDetail', () => {
        test('should build detail with requestUrl and requestId', () => {
            const requestInfo = { originalUrl: '/Patient', requestId: 'req-1' };
            const detail = auditLogger._buildEntityDetail(requestInfo, {});
            expect(detail).toEqual([
                { type: 'requestUrl', valueString: '/Patient' },
                { type: 'requestId', valueString: 'req-1' }
            ]);
        });

        test('should filter out _id and _source from args', () => {
            const requestInfo = { originalUrl: '/Patient', requestId: 'req-1' };
            const args = { _id: 'some-id', _source: 'src', name: 'John' };
            const detail = auditLogger._buildEntityDetail(requestInfo, args);
            expect(detail.find(d => d.type === '_id')).toBeUndefined();
            expect(detail.find(d => d.type === '_source')).toBeUndefined();
            expect(detail.find(d => d.type === 'name')).toEqual({ type: 'name', valueString: 'John' });
        });

        test('should blank out id value', () => {
            const requestInfo = {};
            const args = { id: 'patient-123' };
            const detail = auditLogger._buildEntityDetail(requestInfo, args);
            expect(detail.find(d => d.type === 'id')).toEqual({ type: 'id', valueString: '' });
        });

        test('should drop non-string arg values', () => {
            const requestInfo = {};
            const args = { count: 5, flag: true, name: 'test' };
            const detail = auditLogger._buildEntityDetail(requestInfo, args);
            expect(detail.find(d => d.type === 'count')).toBeUndefined();
            expect(detail.find(d => d.type === 'flag')).toBeUndefined();
            expect(detail.find(d => d.type === 'name')).toBeDefined();
        });

        test('should handle null args', () => {
            const requestInfo = { originalUrl: '/Patient' };
            const detail = auditLogger._buildEntityDetail(requestInfo, null);
            expect(detail).toHaveLength(1);
        });
    });

    // =====================================================
    // Tests for createAuditEntry
    // =====================================================
    describe('createAuditEntry', () => {
        test('should create a valid audit event', () => {
            const requestInfo = {
                isUser: true,
                user: 'user-1',
                alternateUserId: 'alt-1',
                remoteIpAddress: '10.0.0.1',
                originalUrl: '/Patient/123',
                requestId: 'req-1',
                actor: {}
            };
            const entry = auditLogger.createAuditEntry({
                requestInfo,
                resourceType: 'Patient',
                operation: 'read',
                args: {},
                ids: ['123']
            });
            expect(entry.resourceType).toBe('AuditEvent');
            expect(entry.id).toBe('test-uuid-123');
            expect(entry.action).toBe('R');
            expect(entry.entity).toHaveLength(1);
            expect(entry.entity[0].what.reference).toBe('Patient/123');
        });

        test('should map operation codes correctly', () => {
            const requestInfo = { isUser: false, actor: {} };
            const operations = ['create', 'read', 'update', 'delete', 'execute'];
            const expectedCodes = ['C', 'R', 'U', 'D', 'E'];
            operations.forEach((op, i) => {
                const entry = auditLogger.createAuditEntry({
                    requestInfo, resourceType: 'Patient', operation: op, args: {}, ids: ['1']
                });
                expect(entry.action).toBe(expectedCodes[i]);
            });
        });

        test('should return undefined action for unknown operation', () => {
            const requestInfo = { isUser: false, actor: {} };
            const entry = auditLogger.createAuditEntry({
                requestInfo, resourceType: 'Patient', operation: 'unknown', args: {}, ids: ['1']
            });
            expect(entry.action).toBeUndefined();
        });

        test('should include purposeOfEvent when present', () => {
            const requestInfo = {
                isUser: true,
                user: 'user-1',
                purposeOfUse: ['TREAT', 'HPAYMT'],
                actor: {}
            };
            const entry = auditLogger.createAuditEntry({
                requestInfo, resourceType: 'Patient', operation: 'read', args: {}, ids: ['1']
            });
            expect(entry.purposeOfEvent).toHaveLength(2);
            expect(entry.purposeOfEvent[0].coding[0].code).toBe('TREAT');
        });

        // BUG TEST: null/empty ids array
        test('should handle empty ids array producing empty entity array', () => {
            const requestInfo = { isUser: false, actor: {} };
            const entry = auditLogger.createAuditEntry({
                requestInfo, resourceType: 'Patient', operation: 'read', args: {}, ids: []
            });
            expect(entry.entity).toEqual([]);
        });

        // entity detail is only set for index 0
        test('should only include detail on first entity', () => {
            const requestInfo = { originalUrl: '/Patient', requestId: 'req-1', isUser: false, actor: {} };
            const entry = auditLogger.createAuditEntry({
                requestInfo, resourceType: 'Patient', operation: 'read', args: {}, ids: ['1', '2', '3']
            });
            expect(entry.entity[0].detail).toBeDefined();
            expect(entry.entity[0].detail.length).toBeGreaterThan(0);
            expect(entry.entity[1].detail).toBeNull();
            expect(entry.entity[2].detail).toBeNull();
        });
    });

    // =====================================================
    // Tests for logAuditEntryAsync
    // =====================================================
    describe('logAuditEntryAsync', () => {
        test('should skip when enableAccessAuditEvent is false', async () => {
            auditLogger.enableAccessAuditEvent = false;
            await auditLogger.logAuditEntryAsync({
                requestInfo: {}, base_version: '4_0_0', resourceType: 'Patient',
                operation: 'read', args: {}, ids: ['1']
            });
            expect(auditLogger.queue).toHaveLength(0);
        });

        test('should skip when resourceType is AuditEvent', async () => {
            await auditLogger.logAuditEntryAsync({
                requestInfo: { requestId: 'r1' }, base_version: '4_0_0', resourceType: 'AuditEvent',
                operation: 'read', args: {}, ids: ['1']
            });
            expect(auditLogger.queue).toHaveLength(0);
        });

        test('should chunk ids based on maxIdsPerAuditEvent', async () => {
            auditLogger.maxIdsPerAuditEvent = 2;
            const requestInfo = { isUser: false, requestId: 'r1', actor: {} };
            await auditLogger.logAuditEntryAsync({
                requestInfo, base_version: '4_0_0', resourceType: 'Patient',
                operation: 'read', args: {}, ids: ['1', '2', '3', '4', '5']
            });
            // 5 ids / 2 per chunk = 3 audit events
            expect(auditLogger.queue).toHaveLength(3);
        });

        test('should add serialized doc to queue', async () => {
            const requestInfo = { isUser: false, requestId: 'r1', actor: {} };
            await auditLogger.logAuditEntryAsync({
                requestInfo, base_version: '4_0_0', resourceType: 'Patient',
                operation: 'read', args: {}, ids: ['1']
            });
            expect(auditLogger.queue).toHaveLength(1);
            expect(auditLogger.queue[0].doc.resourceType).toBe('AuditEvent');
        });
    });

    // =====================================================
    // Tests for createErrorAuditEntry
    // =====================================================
    describe('createErrorAuditEntry', () => {
        test('should create security alert type for 401', () => {
            const requestInfo = { isUser: false, actor: {} };
            const entry = auditLogger.createErrorAuditEntry({
                requestInfo, resourceType: 'Patient', errorCode: 401, errorMessage: 'Unauthorized'
            });
            expect(entry.type.code).toBe('110113');
            expect(entry.type.display).toBe('Security Alert');
            expect(entry.outcome).toBe('4');
        });

        test('should create security alert type for 403', () => {
            const requestInfo = { isUser: false, actor: {} };
            const entry = auditLogger.createErrorAuditEntry({
                requestInfo, resourceType: 'Patient', errorCode: 403, errorMessage: 'Forbidden'
            });
            expect(entry.type.code).toBe('110113');
        });

        test('should create RESTful Operation type for 500', () => {
            const requestInfo = { isUser: false, actor: {} };
            const entry = auditLogger.createErrorAuditEntry({
                requestInfo, resourceType: 'Patient', errorCode: 500, errorMessage: 'Server error'
            });
            expect(entry.type.code).toBe('rest');
            expect(entry.outcome).toBe('8');
        });

        test('should create RESTful Operation type for 404', () => {
            const requestInfo = { isUser: false, actor: {} };
            const entry = auditLogger.createErrorAuditEntry({
                requestInfo, resourceType: 'Patient', errorCode: 404, errorMessage: 'Not found'
            });
            expect(entry.type.code).toBe('rest');
            expect(entry.outcome).toBe('4');
        });

        // BUG TEST: errorCode = 0 (abort) outcome is '4' but really should be different?
        test('should set outcome to 4 for errorCode 0 (abort)', () => {
            const requestInfo = { isUser: false, actor: {} };
            const entry = auditLogger.createErrorAuditEntry({
                requestInfo, resourceType: null, errorCode: 0, errorMessage: 'Aborted'
            });
            // 0 >= 500 is false, so outcome = '4'
            expect(entry.outcome).toBe('4');
        });

        test('should include extraParams in entity detail', () => {
            const requestInfo = { originalUrl: '/Patient', requestId: 'r1', isUser: false, actor: {} };
            const extraParams = [{ type: 'extra', valueString: 'value' }];
            const entry = auditLogger.createErrorAuditEntry({
                requestInfo, resourceType: 'Patient', errorCode: 500,
                errorMessage: 'Error', extraParams
            });
            expect(entry.entity[0].detail).toContainEqual({ type: 'extra', valueString: 'value' });
        });

        test('should return undefined entity when no detail available', () => {
            const requestInfo = { isUser: false, actor: {} };
            const entry = auditLogger.createErrorAuditEntry({
                requestInfo, resourceType: 'Patient', errorCode: 500, errorMessage: 'Error'
            });
            expect(entry.entity).toBeUndefined();
        });
    });

    // =====================================================
    // Tests for flushAsync
    // =====================================================
    describe('flushAsync', () => {
        test('should do nothing when queue is empty', async () => {
            await auditLogger.flushAsync();
            expect(mockDatabaseBulkInserter.executeAsync).not.toHaveBeenCalled();
        });

        test('should flush queue and call executeAsync', async () => {
            auditLogger.queue = [
                { doc: { resourceType: 'AuditEvent', id: '1' }, requestInfo: { requestId: 'r1' } },
                { doc: { resourceType: 'AuditEvent', id: '2' }, requestInfo: { requestId: 'r2' } }
            ];
            await auditLogger.flushAsync();
            expect(mockDatabaseBulkInserter.executeAsync).toHaveBeenCalledTimes(1);
            expect(auditLogger.queue).toHaveLength(0);
        });

        test('should log error when mergeResults contain issues', async () => {
            mockDatabaseBulkInserter.executeAsync.mockResolvedValue([
                { issue: 'some error' }
            ]);
            auditLogger.queue = [
                { doc: { resourceType: 'AuditEvent', id: '1' }, requestInfo: { requestId: 'r1' } }
            ];
            await auditLogger.flushAsync();
            expect(logError).toHaveBeenCalledWith(
                'Error creating audit entries',
                expect.objectContaining({ source: 'flushAsync' })
            );
        });

        // BUG TEST: executeAsync returns null/undefined - crashes on .filter()
        test('BUG: flushAsync crashes when executeAsync returns null', async () => {
            mockDatabaseBulkInserter.executeAsync.mockResolvedValue(null);
            auditLogger.queue = [
                { doc: { resourceType: 'AuditEvent', id: '1' }, requestInfo: { requestId: 'r1' } }
            ];
            // Line 384: `const mergeResultErrors = mergeResults.filter((m) => m.issue);`
            // If mergeResults is null, calling .filter() throws TypeError
            await expect(auditLogger.flushAsync()).rejects.toThrow();
        });

        // BUG TEST: executeAsync returns undefined
        test('BUG: flushAsync crashes when executeAsync returns undefined', async () => {
            mockDatabaseBulkInserter.executeAsync.mockResolvedValue(undefined);
            auditLogger.queue = [
                { doc: { resourceType: 'AuditEvent', id: '1' }, requestInfo: { requestId: 'r1' } }
            ];
            await expect(auditLogger.flushAsync()).rejects.toThrow();
        });
    });
});
