/**
 * Tests that AuditLogger correctly produces audit events for PHI access patterns.
 * Validates runtime behavior: event structure, failure recording, and consent auditing.
 */
const { describe, test, expect, jest } = require('@jest/globals');

jest.mock('express-http-context', () => {
    const { jest: j } = require('@jest/globals');
    return { get: j.fn(), set: j.fn() };
});

jest.mock('../../../../operations/common/logging', () => {
    const { jest: j } = require('@jest/globals');
    return { logInfo: j.fn(), logError: j.fn(), logDebug: j.fn(), logWarn: j.fn() };
});

jest.mock('../../../../fhir/fhirResourceSerializer', () => {
    const { jest: j } = require('@jest/globals');
    return {
        FhirResourceSerializer: {
            serialize: j.fn((json) => json),
            serializeByResourceType: j.fn((resource) => resource)
        }
    };
});

jest.mock('../../../../utils/uid.util', () => {
    const { jest: j } = require('@jest/globals');
    return { generateUUID: j.fn(() => 'test-uuid-123') };
});

jest.mock('../../../../fhir/fhirResourceWriteSerializer', () => {
    const { jest: j } = require('@jest/globals');
    return {
        FhirResourceWriteSerializer: {
            serialize: j.fn(({ obj }) => obj)
        }
    };
});

jest.mock('../../../../dataLayer/bulkWriteRequestContext', () => {
    const { jest: j } = require('@jest/globals');
    return {
        buildBulkWriteRequestContext: j.fn((requestInfo) => ({
            requestId: requestInfo.requestId
        }))
    };
});

const { AuditLogger } = require('../../../../utils/auditLogger');
const { PostRequestProcessor } = require('../../../../utils/postRequestProcessor');
const { PreSaveManager } = require('../../../../preSaveHandlers/preSave');
const { ConfigManager } = require('../../../../utils/configManager');

function createMockInstance(ClassType) {
    return Object.create(ClassType.prototype);
}

function createMockRequestInfo(overrides = {}) {
    return {
        user: 'test-user',
        scope: 'user/*.read user/*.write access/tenant-a.*',
        isUser: false,
        personIdFromJwtToken: 'person-123',
        requestId: 'req-001',
        originalUrl: '/4_0_0/Patient/patient-1',
        remoteIpAddress: '10.0.0.1',
        headers: {},
        userType: null,
        actor: null,
        alternateUserId: 'alt-user-1',
        purposeOfUse: [],
        ...overrides
    };
}

function createAuditLogger(configOverrides = {}) {
    const mockPostRequestProcessor = createMockInstance(PostRequestProcessor);
    const mockDatabaseBulkInserter = {
        getOperationForResourceAsync: jest.fn().mockReturnValue({ op: 'insert' }),
        executeAsync: jest.fn().mockResolvedValue([])
    };
    const mockPreSaveManager = createMockInstance(PreSaveManager);
    mockPreSaveManager.preSaveAsync = jest.fn().mockImplementation(({ resource }) => resource);

    const mockConfigManager = createMockInstance(ConfigManager);
    Object.defineProperty(mockConfigManager, 'maxIdsPerAuditEvent', {
        get: () => configOverrides.maxIdsPerAuditEvent || 1000,
        configurable: true
    });
    Object.defineProperty(mockConfigManager, 'enableAccessAuditEvent', {
        get: () => configOverrides.enableAccessAuditEvent !== undefined
            ? configOverrides.enableAccessAuditEvent
            : true,
        configurable: true
    });
    Object.defineProperty(mockConfigManager, 'auditEventObserverOrganizationId', {
        get: () => 'org-123',
        configurable: true
    });

    return new AuditLogger({
        postRequestProcessor: mockPostRequestProcessor,
        databaseBulkInserter: mockDatabaseBulkInserter,
        preSaveManager: mockPreSaveManager,
        configManager: mockConfigManager,
        base_version: '4_0_0'
    });
}

describe('AuditLogger - Runtime Behavior', () => {
    describe('Failed authentication attempts', () => {
        test('401 audit events include the failure reason and Security Alert type', async () => {
            const auditLogger = createAuditLogger();

            const requestInfo = createMockRequestInfo({
                user: null,
                scope: null
            });

            await auditLogger.logErrorAuditEntryAsync({
                requestInfo,
                resourceType: 'Patient',
                errorCode: 401,
                errorMessage: 'Token Expired'
            });

            expect(auditLogger.queue.length).toBe(1);
            const auditEvent = auditLogger.queue[0].doc;

            expect(auditEvent.type.code).toBe('110113');
            expect(auditEvent.type.display).toBe('Security Alert');
            expect(auditEvent.outcomeDesc).toBe('Token Expired');
            expect(auditEvent.outcome).toBe('4');
        });

        test('403 scope failures are audited with scope details', async () => {
            const auditLogger = createAuditLogger();

            const requestInfo = createMockRequestInfo({
                scope: 'patient/Observation.read'
            });

            await auditLogger.logErrorAuditEntryAsync({
                requestInfo,
                resourceType: 'Patient',
                errorCode: 403,
                errorMessage: 'user test-user failed access check to [Patient.read]',
                extraParams: [{ type: 'scope', valueString: 'patient/Observation.read' }]
            });

            expect(auditLogger.queue.length).toBe(1);
            const auditEvent = auditLogger.queue[0].doc;

            expect(auditEvent.type.code).toBe('110113');
            const scopeDetail = auditEvent.entity[0].detail.find(
                d => d.type === 'scope'
            );
            expect(scopeDetail).toBeDefined();
            expect(scopeDetail.valueString).toBe('patient/Observation.read');
        });
    });

    describe('Patient scope access auditing', () => {
        test('audit events for patient-scope access include who reference', async () => {
            const auditLogger = createAuditLogger();

            const requestInfo = createMockRequestInfo({
                user: 'patient-user-123',
                scope: 'patient/Patient.read patient/Observation.read',
                isUser: true
            });

            await auditLogger.logAuditEntryAsync({
                requestInfo,
                base_version: '4_0_0',
                resourceType: 'Observation',
                operation: 'read',
                args: { id: 'obs-456' },
                ids: ['obs-uuid-789']
            });

            expect(auditLogger.queue.length).toBe(1);
            const auditEvent = auditLogger.queue[0].doc;

            expect(auditEvent.agent[0].who).toBeDefined();
            expect(auditEvent.agent[0].who.reference).toContain('patient-user-123');
            expect(auditEvent.entity[0].what.reference).toBe('Observation/obs-uuid-789');
        });
    });

    describe('Consent operations auditing', () => {
        test('consent write operations produce audit events with correct action code', async () => {
            const auditLogger = createAuditLogger();

            await auditLogger.logAuditEntryAsync({
                requestInfo: createMockRequestInfo(),
                base_version: '4_0_0',
                resourceType: 'Consent',
                operation: 'update',
                args: { id: 'consent-123' },
                ids: ['consent-uuid-456']
            });

            expect(auditLogger.queue.length).toBe(1);
            const auditEvent = auditLogger.queue[0].doc;

            expect(auditEvent.action).toBe('U');
            expect(auditEvent.entity[0].what.reference).toBe('Consent/consent-uuid-456');
        });

        test('consent create operations produce audit events', async () => {
            const auditLogger = createAuditLogger();

            await auditLogger.logAuditEntryAsync({
                requestInfo: createMockRequestInfo(),
                base_version: '4_0_0',
                resourceType: 'Consent',
                operation: 'create',
                args: {},
                ids: ['new-consent-uuid']
            });

            expect(auditLogger.queue.length).toBe(1);
            const auditEvent = auditLogger.queue[0].doc;
            expect(auditEvent.action).toBe('C');
            expect(auditEvent.entity[0].what.reference).toBe('Consent/new-consent-uuid');
        });
    });
});
