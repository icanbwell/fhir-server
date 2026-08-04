const { describe, test, expect, jest, beforeAll, beforeEach } = require('@jest/globals');
const { AuditLogger } = require('../../utils/auditLogger');
const { PostRequestProcessor } = require('../../utils/postRequestProcessor');
const { FastDatabaseBulkInserter } = require('../../dataLayer/fastDatabaseBulkInserter');
const { PreSaveManager } = require('../../preSaveHandlers/preSave');
const { ConfigManager } = require('../../utils/configManager');
const BaseSerializer = require('../../fhir/writeSerializers/4_0_0/customSerializers/baseSerializer');

describe('AuditLogger Error Audit', () => {
    let mockPostRequestProcessor;
    let mockDatabaseBulkInserter;
    let mockPreSaveManager;
    let mockConfigManager;

    beforeAll(() => {
        // Production wires this once at startup (src/index.js); unit tests must set it
        // before invoking FhirResourceWriteSerializer in logErrorAuditEntryAsync.
        const serializerConfig = Object.create(ConfigManager.prototype);
        BaseSerializer.setConfigManager(serializerConfig);
    });

    beforeEach(() => {
        mockPostRequestProcessor = Object.create(PostRequestProcessor.prototype);
        mockPostRequestProcessor.add = jest.fn();

        mockDatabaseBulkInserter = Object.create(FastDatabaseBulkInserter.prototype);
        mockDatabaseBulkInserter.getOperationForResourceAsync = jest.fn().mockReturnValue({});
        mockDatabaseBulkInserter.executeAsync = jest.fn().mockResolvedValue([]);

        mockPreSaveManager = Object.create(PreSaveManager.prototype);
        mockPreSaveManager.preSaveAsync = jest.fn().mockResolvedValue(undefined);

        mockConfigManager = Object.create(ConfigManager.prototype);
        Object.defineProperty(mockConfigManager, 'enableAccessAuditEvent', { get: () => true, configurable: true });
        Object.defineProperty(mockConfigManager, 'maxIdsPerAuditEvent', { get: () => 50, configurable: true });
    });

    function createAuditLogger (overrides = {}) {
        const config = overrides.configManager || mockConfigManager;
        return new AuditLogger({
            postRequestProcessor: mockPostRequestProcessor,
            databaseBulkInserter: mockDatabaseBulkInserter,
            preSaveManager: mockPreSaveManager,
            configManager: config
        });
    }

    function createMockRequestInfo () {
        return {
            user: 'test-user-123',
            isUser: true,
            alternateUserId: 'alt-user',
            remoteIpAddress: '192.168.1.1',
            originalUrl: '/4_0_0/Patient/123',
            requestId: 'req-123',
            scope: 'patient/*.read',
            userType: 'user'
        };
    }

    describe('createErrorAuditEntry', () => {
        test('creates 401 audit event with Security Alert type', () => {
            const logger = createAuditLogger();
            const result = logger.createErrorAuditEntry({
                requestInfo: createMockRequestInfo(),
                resourceType: 'Patient',
                errorCode: 401,
                errorMessage: 'Authentication Failed'
            });

            expect(result.type.code).toBe('110113');
            expect(result.type.display).toBe('Security Alert');
            expect(result.subtype).toBeUndefined();
            expect(result.action).toBe('E');
            expect(result.outcome).toBe('4');
            expect(result.outcomeDesc).toBe('Authentication Failed');
        });

        test('creates 403 audit event with Security Alert type', () => {
            const logger = createAuditLogger();
            const result = logger.createErrorAuditEntry({
                requestInfo: createMockRequestInfo(),
                resourceType: 'Patient',
                errorCode: 403,
                errorMessage: 'Insufficient scopes'
            });

            expect(result.type.code).toBe('110113');
            expect(result.type.display).toBe('Security Alert');
            expect(result.subtype).toBeUndefined();
            expect(result.action).toBe('E');
            expect(result.outcome).toBe('4');
            expect(result.outcomeDesc).toBe('Insufficient scopes');
        });

        test('creates 404 audit event with REST type', () => {
            const logger = createAuditLogger();
            const result = logger.createErrorAuditEntry({
                requestInfo: createMockRequestInfo(),
                resourceType: 'Patient',
                errorCode: 404,
                errorMessage: 'Resource not found: Patient/123'
            });

            expect(result.type.code).toBe('rest');
            expect(result.type.system).toBe('http://terminology.hl7.org/CodeSystem/audit-event-type');
            expect(result.subtype).toBeUndefined();
            expect(result.action).toBe('E');
            expect(result.outcome).toBe('4');
            expect(result.outcomeDesc).toBe('Resource not found: Patient/123');
        });

        test('creates 500 audit event with serious failure outcome', () => {
            const logger = createAuditLogger();
            const result = logger.createErrorAuditEntry({
                requestInfo: createMockRequestInfo(),
                resourceType: 'Patient',
                errorCode: 500,
                errorMessage: 'Internal Server Error'
            });

            expect(result.type.code).toBe('rest');
            expect(result.action).toBe('E');
            expect(result.outcome).toBe('8');
        });

        test('includes agent with user reference when requestInfo has user', () => {
            const logger = createAuditLogger();
            const result = logger.createErrorAuditEntry({
                requestInfo: createMockRequestInfo(),
                resourceType: 'Patient',
                errorCode: 403,
                errorMessage: 'Forbidden'
            });

            expect(result.agent[0].who.reference).toContain('test-user-123');
            expect(result.agent[0].network.address).toBe('192.168.1.1');
            expect(result.agent[0].requestor).toBe(true);
        });

        test('creates two agents for delegated user', () => {
            const logger = createAuditLogger();
            const requestInfo = createMockRequestInfo();
            requestInfo.userType = 'delegatedUser';
            requestInfo.actor = {
                reference: 'Practitioner/delegated-actor-1',
                sub: 'delegated-sub',
                consentPolicy: 'http://example.com/consent/123'
            };
            const result = logger.createErrorAuditEntry({
                requestInfo,
                resourceType: 'Patient',
                errorCode: 403,
                errorMessage: 'Forbidden'
            });

            expect(result.agent).toHaveLength(2);
            expect(result.agent[0].requestor).toBe(false);
            expect(result.agent[0].who.reference).toContain('test-user-123');
            expect(result.agent[1].requestor).toBe(true);
            expect(result.agent[1].who.reference).toBe('Practitioner/delegated-actor-1');
            expect(result.agent[1].policy).toEqual(['http://example.com/consent/123']);
        });

        test('includes entity with requestUrl and requestId detail but no what reference', () => {
            const logger = createAuditLogger();
            const result = logger.createErrorAuditEntry({
                requestInfo: createMockRequestInfo(),
                resourceType: 'Patient',
                errorCode: 404,
                errorMessage: 'Not found'
            });

            expect(result.entity[0].what).toBeUndefined();
            const detail = result.entity[0].detail;
            expect(detail.find(d => d.type === 'requestUrl').valueString).toBe('/4_0_0/Patient/123');
            expect(detail.find(d => d.type === 'requestId').valueString).toBe('req-123');
        });

        test('includes extraParams in entity detail', () => {
            const logger = createAuditLogger();
            const extraParams = [
                { type: 'jwtPayload', valueString: JSON.stringify({ sub: 'user-1', iss: 'https://auth.test', scope: 'patient/*.read' }) }
            ];
            const result = logger.createErrorAuditEntry({
                requestInfo: createMockRequestInfo(),
                resourceType: 'Patient',
                errorCode: 401,
                errorMessage: 'Invalid token',
                extraParams
            });

            const detail = result.entity[0].detail;
            const jwtEntry = detail.find(d => d.type === 'jwtPayload');
            expect(jwtEntry).toBeDefined();
            const parsed = JSON.parse(jwtEntry.valueString);
            expect(parsed.sub).toBe('user-1');
            expect(parsed.iss).toBe('https://auth.test');
            expect(parsed.scope).toBe('patient/*.read');
        });

        test('does not include extraParams when not provided (backward compat)', () => {
            const logger = createAuditLogger();
            const result = logger.createErrorAuditEntry({
                requestInfo: createMockRequestInfo(),
                resourceType: 'Patient',
                errorCode: 404,
                errorMessage: 'Not found'
            });

            const detail = result.entity[0].detail;
            expect(detail.find(d => d.type === 'jwtPayload')).toBeUndefined();
        });

    });

    describe('logErrorAuditEntryAsync', () => {
        test('queues audit entry when enableAccessAuditEvent is true', async () => {
            const logger = createAuditLogger();
            await logger.logErrorAuditEntryAsync({
                requestInfo: createMockRequestInfo(),
                resourceType: 'Patient',
                errorCode: 403,
                errorMessage: 'Forbidden'
            });

            expect(mockPreSaveManager.preSaveAsync).toHaveBeenCalledTimes(1);
            expect(logger.queue.length).toBe(1);
            expect(logger.queue[0].doc.outcome).toBe('4');
        });

        test('skips when enableAccessAuditEvent is false', async () => {
            Object.defineProperty(mockConfigManager, 'enableAccessAuditEvent', { get: () => false, configurable: true });
            const logger = createAuditLogger();
            await logger.logErrorAuditEntryAsync({
                requestInfo: createMockRequestInfo(),
                resourceType: 'Patient',
                errorCode: 403,
                errorMessage: 'Forbidden'
            });

            expect(logger.queue.length).toBe(0);
        });

        test('does not skip when resourceType is AuditEvent (tracks errors on audit operations)', async () => {
            const logger = createAuditLogger();
            await logger.logErrorAuditEntryAsync({
                requestInfo: createMockRequestInfo(),
                resourceType: 'AuditEvent',
                errorCode: 404,
                errorMessage: 'Not found'
            });

            expect(logger.queue.length).toBe(1);
        });

        test('includes requestId in entity detail', async () => {
            const logger = createAuditLogger();
            await logger.logErrorAuditEntryAsync({
                requestInfo: createMockRequestInfo(),
                resourceType: 'Patient',
                errorCode: 403,
                errorMessage: 'Forbidden'
            });

            expect(logger.queue.length).toBe(1);
            const detail = logger.queue[0].doc.entity[0].detail;
            expect(detail.find(d => d.type === 'requestUrl').valueString).toBe('/4_0_0/Patient/123');
            expect(detail.find(d => d.type === 'requestId').valueString).toBe('req-123');
        });

        test('passes jwtPayload as extraParams for invalid_token', async () => {
            const logger = createAuditLogger();
            const extraParams = [
                { type: 'jwtPayload', valueString: JSON.stringify({ sub: 'user-1', iss: 'https://auth.test', exp: 1715500800 }) }
            ];
            await logger.logErrorAuditEntryAsync({
                requestInfo: createMockRequestInfo(),
                resourceType: 'Patient',
                errorCode: 401,
                errorMessage: 'Invalid token',
                extraParams
            });

            expect(logger.queue.length).toBe(1);
            const detail = logger.queue[0].doc.entity[0].detail;
            const jwtEntry = detail.find(d => d.type === 'jwtPayload');
            const parsed = JSON.parse(jwtEntry.valueString);
            expect(parsed.sub).toBe('user-1');
            expect(parsed.exp).toBe(1715500800);
        });

        test('no extraParams for no_token scenario, outcomeDesc reflects reason', async () => {
            const logger = createAuditLogger();
            await logger.logErrorAuditEntryAsync({
                requestInfo: createMockRequestInfo(),
                resourceType: 'Patient',
                errorCode: 401,
                errorMessage: 'No token available'
            });

            expect(logger.queue.length).toBe(1);
            expect(logger.queue[0].doc.outcomeDesc).toBe('No token available');
            const detail = logger.queue[0].doc.entity[0].detail;
            expect(detail.find(d => d.type === 'jwtPayload')).toBeUndefined();
        });

        test('queues merge error with per-item failure message', async () => {
            const logger = createAuditLogger();
            const requestInfo = createMockRequestInfo();
            requestInfo.originalUrl = '/4_0_0/Patient/$merge';

            await logger.logErrorAuditEntryAsync({
                requestInfo,
                resourceType: 'Patient',
                errorCode: 400,
                errorMessage: 'Patient/abc123: Duplicate detected during merge'
            });

            expect(logger.queue.length).toBe(1);
            const doc = logger.queue[0].doc;
            expect(doc.type.code).toBe('rest');
            expect(doc.outcome).toBe('4');
            expect(doc.outcomeDesc).toBe('Patient/abc123: Duplicate detected during merge');
            const detail = doc.entity[0].detail;
            expect(detail.find(d => d.type === 'requestUrl').valueString).toBe('/4_0_0/Patient/$merge');
        });

        test('queues multiple merge errors independently', async () => {
            const logger = createAuditLogger();
            const requestInfo = createMockRequestInfo();

            const failedItems = [
                { id: 'abc', issue: { details: { text: 'Duplicate detected' } } },
                { id: 'def', issue: { diagnostics: 'Version conflict' } }
            ];

            for (const entry of failedItems) {
                const errorDetail = entry.issue?.details?.text || entry.issue?.diagnostics || 'Merge failed';
                await logger.logErrorAuditEntryAsync({
                    requestInfo,
                    resourceType: 'Patient',
                    errorCode: 400,
                    errorMessage: `Patient/${entry.id}: ${errorDetail}`
                });
            }

            expect(logger.queue.length).toBe(2);
            expect(logger.queue[0].doc.outcomeDesc).toBe('Patient/abc: Duplicate detected');
            expect(logger.queue[1].doc.outcomeDesc).toBe('Patient/def: Version conflict');
        });

        test('queues abort event with errorCode 0 when client disconnects', async () => {
            const logger = createAuditLogger();
            const requestInfo = createMockRequestInfo();
            requestInfo.originalUrl = '/4_0_0/Patient?name=test';

            await logger.logErrorAuditEntryAsync({
                requestInfo,
                resourceType: 'Patient',
                errorCode: 0,
                errorMessage: 'Request Aborted by Client'
            });

            expect(logger.queue.length).toBe(1);
            const doc = logger.queue[0].doc;
            expect(doc.type.code).toBe('rest');
            expect(doc.outcome).toBe('4');
            expect(doc.outcomeDesc).toBe('Request Aborted by Client');
            expect(doc.agent[0].who.reference).toContain('test-user-123');
            const detail = doc.entity[0].detail;
            expect(detail.find(d => d.type === 'requestUrl').valueString).toBe('/4_0_0/Patient?name=test');
        });

        test('flushes error audit events to database', async () => {
            const logger = createAuditLogger();
            await logger.logErrorAuditEntryAsync({
                requestInfo: createMockRequestInfo(),
                resourceType: 'Patient',
                errorCode: 404,
                errorMessage: 'Not found'
            });

            await logger.flushAsync();

            expect(mockDatabaseBulkInserter.getOperationForResourceAsync).toHaveBeenCalledTimes(1);
            expect(mockDatabaseBulkInserter.executeAsync).toHaveBeenCalledTimes(1);
        });
    });
});
