/**
 * HIPAA/HITRUST CSF 09.aa Audit Logging Gap Tests
 *
 * These tests verify that ALL access to PHI produces audit events, including:
 * - Read/write operations creating AuditEvents
 * - Failed auth attempts being logged
 * - Patient scope bypasses being logged identically to normal access
 * - Bulk export downloads creating audit trails
 * - GraphQL operations audited at same level as REST
 * - No code path that silently skips audit logging
 * - Admin operations being logged
 * - Consent access/revocation being audited
 *
 * HITRUST CSF 09.aa: "All access to PHI must be logged."
 * Tests assert CORRECT behavior so they FAIL on buggy code.
 */
const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

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

describe('HITRUST 09.aa - Audit Logging Gaps', () => {
    describe('Gap 1: Patch operation must create audit events', () => {
        /**
         * PATCH modifies PHI (e.g., changing a patient's address or medication).
         * HITRUST requires ALL writes to PHI be logged.
         * The patch operation currently has NO auditLogger dependency.
         */
        test('patch operation should have auditLogger as a dependency for write auditing', () => {
            const { PatchOperation } = require('../../../../operations/patch/patch');

            // Inspect the constructor to see if it accepts an auditLogger parameter.
            // A HIPAA-compliant patch operation MUST log audit events for modifications.
            const patchOp = Object.getOwnPropertyNames(PatchOperation.prototype);
            const constructorStr = PatchOperation.toString();

            // The patch operation must accept an auditLogger to log PHI modifications
            expect(constructorStr).toContain('auditLogger');
        });

        test('patch operation should call logAuditEntryAsync after successful patch', () => {
            // Read the source to verify audit logging is invoked after patch completes
            const fs = require('fs');
            const patchSource = fs.readFileSync(
                require.resolve('../../../../operations/patch/patch'),
                'utf8'
            );

            // After a successful patch, the operation MUST call logAuditEntryAsync
            // to record the PHI modification in the audit trail
            expect(patchSource).toContain('logAuditEntryAsync');
        });
    });

    describe('Gap 2: History operations must create audit events', () => {
        /**
         * The history operation returns prior versions of PHI resources.
         * Accessing historical PHI versions is still PHI access and must be logged.
         */
        test('history operation should invoke audit logging for PHI version access', () => {
            const fs = require('fs');
            const historySource = fs.readFileSync(
                require.resolve('../../../../operations/history/history'),
                'utf8'
            );

            // History returns previous versions of resources containing PHI.
            // Each access to historical PHI MUST be audited per HITRUST 09.aa.
            expect(historySource).toContain('logAuditEntryAsync');
        });

        test('historyById operation should invoke audit logging', () => {
            const fs = require('fs');
            const historyByIdSource = fs.readFileSync(
                require.resolve('../../../../operations/historyById/historyById'),
                'utf8'
            );

            // Accessing a specific resource version history is PHI access
            expect(historyByIdSource).toContain('logAuditEntryAsync');
        });
    });

    describe('Gap 3: SearchByVersionId must create audit events', () => {
        /**
         * Retrieving a specific version of a resource is reading PHI.
         * This must be audited per HITRUST requirements.
         */
        test('searchByVersionId should invoke audit logging', () => {
            const fs = require('fs');
            const source = fs.readFileSync(
                require.resolve('../../../../operations/searchByVersionId/searchByVersionId'),
                'utf8'
            );

            expect(source).toContain('logAuditEntryAsync');
        });
    });

    describe('Gap 4: Failed authentication attempts must be audited', () => {
        /**
         * HITRUST 09.aa and HIPAA 164.312(b): Failed login/access attempts
         * must be logged for intrusion detection. The middleware currently stores
         * failure details on req.authFailureDetail but actual AuditEvent creation
         * only happens in the response handler (app.js). If the response handler
         * fails or the request is aborted before finish, the 401 audit event is lost.
         */
        test('401 audit events should include the specific failure reason', async () => {
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

            // The audit event MUST record it as a Security Alert
            expect(auditEvent.type.code).toBe('110113');
            expect(auditEvent.type.display).toBe('Security Alert');
            // The outcome description MUST capture why the auth failed
            expect(auditEvent.outcomeDesc).toBe('Token Expired');
            // The outcome must indicate a minor failure (4)
            expect(auditEvent.outcome).toBe('4');
        });

        test('403 scope failures must be audited with scope details', async () => {
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

            // 403 errors must also be classified as Security Alerts
            expect(auditEvent.type.code).toBe('110113');
            // The scope that was used in the failed attempt MUST be recorded
            // for forensic analysis of unauthorized access patterns
            const scopeDetail = auditEvent.entity[0].detail.find(
                d => d.type === 'scope'
            );
            expect(scopeDetail).toBeDefined();
            expect(scopeDetail.valueString).toBe('patient/Observation.read');
        });
    });

    describe('Gap 5: Patient scope bypass (scopesManager line 133) must log normally', () => {
        /**
         * The scopesManager.isAccessToResourceAllowedBySecurityTags at line 133
         * returns true for patient scopes WITHOUT checking resource ownership.
         * If exploited for cross-tenant access, the audit event must still record
         * the access with the same detail as non-bypassed access so breach
         * notification can identify affected records.
         */
        test('audit events for patient-scope access must include the patient scope in agent policy', async () => {
            const auditLogger = createAuditLogger();

            // Simulate access via patient scope (the bypass path)
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

            // The agent array MUST have the who reference populated so we can
            // trace WHICH patient scope holder accessed WHICH resource
            expect(auditEvent.agent[0].who).toBeDefined();
            expect(auditEvent.agent[0].who.reference).toContain('patient-user-123');

            // The entity MUST reference the actual resource accessed
            expect(auditEvent.entity[0].what.reference).toBe('Observation/obs-uuid-789');
        });

        test('audit event entity must include resource ID even when accessed via patient scope bypass', async () => {
            const auditLogger = createAuditLogger();

            const requestInfo = createMockRequestInfo({
                user: 'attacker',
                scope: 'patient/Patient.read',
                isUser: true
            });

            // If the scope bypass allows reading another tenant's resource,
            // the audit trail MUST capture the specific resource UUID accessed
            await auditLogger.logAuditEntryAsync({
                requestInfo,
                base_version: '4_0_0',
                resourceType: 'Patient',
                operation: 'read',
                args: {},
                ids: ['cross-tenant-patient-uuid']
            });

            const auditEvent = auditLogger.queue[0].doc;
            // The audit event must contain the exact resource reference for breach notification
            expect(auditEvent.entity[0].what.reference).toBe('Patient/cross-tenant-patient-uuid');
            // And the requesting user must be identifiable
            expect(auditEvent.agent[0].who.reference).toContain('attacker');
        });
    });

    describe('Gap 6: Bulk export download (ExportById) must create audit events', () => {
        /**
         * ExportById returns the status/download URLs for a bulk export.
         * If tenant B accesses tenant A's export (the cross-tenant export bug),
         * there is NO audit trail because ExportById has no auditLogger dependency.
         * This means breach notification is impossible.
         */
        test('exportById operation should have auditLogger dependency', () => {
            const { ExportByIdOperation } = require('../../../../operations/export/exportById');
            const source = ExportByIdOperation.toString();

            // ExportById MUST use an auditLogger to record who accessed export results.
            // Without this, cross-tenant export access leaves no forensic trail.
            expect(source).toContain('auditLogger');
        });

        test('exportById should log audit event with export status ID on successful retrieval', () => {
            const fs = require('fs');
            const source = fs.readFileSync(
                require.resolve('../../../../operations/export/exportById'),
                'utf8'
            );

            // After returning export status (which contains download URLs for PHI),
            // the operation MUST create an audit event recording the access
            expect(source).toContain('logAuditEntryAsync');
        });
    });

    describe('Gap 7: GraphQL operations must be audited at the same level as REST', () => {
        /**
         * The GraphQL dataSource delegates to searchBundleOperation which DOES log.
         * However, GraphQL can resolve nested references via DataLoader batching,
         * and there is no DIRECT audit event creation in the GraphQL layer.
         * The audit only happens if searchBundleOperation is called, but nested
         * reference resolution via the DataLoader may bypass this.
         */
        test('GraphQL dataSource should ensure audit events are created for nested reference loads', () => {
            const fs = require('fs');
            const source = fs.readFileSync(
                require.resolve('../../../../graphqlv2/dataSource'),
                'utf8'
            );

            // The GraphQL data source resolves nested references.
            // It delegates to searchBundleOperation which logs audit events.
            // Verify it actually calls the search operation (which has audit built in)
            // rather than bypassing it with a direct DB query
            expect(source).toContain('searchBundleOperation');

            // The parentOperationType MUST be passed to ensure audit events
            // are not skipped for GraphQL sub-queries
            expect(source).not.toContain('skipAudit');
            expect(source).not.toContain('disableAudit');
        });

        test('GraphQL resolver layer must not have direct DB access that bypasses audit', () => {
            const fs = require('fs');
            const source = fs.readFileSync(
                require.resolve('../../../../graphqlv2/dataSource'),
                'utf8'
            );

            // The data source must NOT directly query MongoDB bypassing the operation layer.
            // Direct DB access would skip the audit logging that happens in operations.
            expect(source).not.toContain('databaseQueryFactory');
            expect(source).not.toContain('collection.find');
            expect(source).not.toContain('mongoClient');
        });
    });

    describe('Gap 8: Code that explicitly skips audit logging', () => {
        /**
         * The AuditLogger.logAuditEntryAsync has an early return when
         * enableAccessAuditEvent is false. If an environment variable is
         * accidentally set to disable this, ALL audit logging silently stops.
         * This is a single point of failure for HIPAA compliance.
         */
        test('disabling audit via enableAccessAuditEvent=false must not be the only guard', async () => {
            // This test documents the risk: if ENABLE_ACCESS_AUDIT_EVENT is false,
            // zero audit events are created for ANY PHI access.
            const auditLogger = createAuditLogger({ enableAccessAuditEvent: false });

            await auditLogger.logAuditEntryAsync({
                requestInfo: createMockRequestInfo(),
                base_version: '4_0_0',
                resourceType: 'Patient',
                operation: 'read',
                args: {},
                ids: ['patient-uuid-1']
            });

            // When disabled, nothing is queued - this is the gap
            expect(auditLogger.queue.length).toBe(0);

            // HITRUST REQUIREMENT: There should be a SEPARATE mechanism
            // (like a critical alert or fallback logger) that fires when
            // audit is disabled, because running without audit is itself
            // a compliance violation. The AuditLogger should log a warning
            // to the system log when it skips an entry due to the flag being off.
            const { logError } = require('../../../../operations/common/logging');
            // The system MUST emit a warning when audit logging is disabled
            // so operations teams can detect misconfiguration
            expect(logError).toHaveBeenCalledWith(
                expect.stringContaining('audit'),
                expect.anything()
            );
        });

        test('AuditEvent resource type access should still be logged somewhere', async () => {
            // The current code skips audit logging when resourceType === 'AuditEvent'
            // to avoid infinite recursion. However, access to AuditEvent resources
            // themselves is PHI access that should be tracked.
            const auditLogger = createAuditLogger();

            await auditLogger.logAuditEntryAsync({
                requestInfo: createMockRequestInfo(),
                base_version: '4_0_0',
                resourceType: 'AuditEvent',
                operation: 'read',
                args: {},
                ids: ['audit-event-uuid-1']
            });

            // Per HITRUST, accessing audit logs is itself an auditable event.
            // The system should have SOME mechanism to record this access,
            // even if not via the same AuditEvent table (to avoid recursion).
            // A separate access log or system event should be created.
            // Currently this is silently dropped.
            expect(auditLogger.queue.length).toBeGreaterThan(0);
        });
    });

    describe('Gap 9: Admin operations must be audited', () => {
        /**
         * Admin endpoints (index management, data export, person matching)
         * have no audit event creation. An insider threat using admin endpoints
         * to extract PHI would leave no forensic trail.
         */
        test('admin route handler must create audit events for data access operations', () => {
            const fs = require('fs');
            const source = fs.readFileSync(
                require.resolve('../../../../routeHandlers/admin'),
                'utf8'
            );

            // Admin operations that access or modify PHI must be audited.
            // Operations like showPersonToPersonLink, searchLogResults expose PHI/PII.
            expect(source).toContain('auditLogger');
        });

        test('admin operations that expose patient linkage data must be audited', () => {
            const fs = require('fs');
            const source = fs.readFileSync(
                require.resolve('../../../../routeHandlers/admin'),
                'utf8'
            );

            // showPersonToPersonLink exposes the relationship between Person and Patient
            // resources - this is PHI (patient identity information).
            // It must create an audit event.
            expect(source).toContain('logAuditEntryAsync');
        });
    });

    describe('Gap 10: Consent access and revocation must be audited', () => {
        /**
         * When consent resources are read or modified, this affects what data
         * can be shared. Changes to consent are especially security-sensitive
         * and must be audited per HIPAA 164.312(b).
         */
        test('consent resource write operations must trigger audit events with consent-specific details', async () => {
            const auditLogger = createAuditLogger();

            // Simulate a consent revocation (update operation on Consent resource)
            const requestInfo = createMockRequestInfo();

            await auditLogger.logAuditEntryAsync({
                requestInfo,
                base_version: '4_0_0',
                resourceType: 'Consent',
                operation: 'update',
                args: { id: 'consent-123' },
                ids: ['consent-uuid-456']
            });

            expect(auditLogger.queue.length).toBe(1);
            const auditEvent = auditLogger.queue[0].doc;

            // The audit event must record this as an Update action
            expect(auditEvent.action).toBe('U');
            // It must reference the specific Consent resource
            expect(auditEvent.entity[0].what.reference).toBe('Consent/consent-uuid-456');
        });

        test('consent operations via merge/create must also trigger audit events', async () => {
            const auditLogger = createAuditLogger();

            // Creating a new consent (granting access) is security-critical
            const requestInfo = createMockRequestInfo();

            await auditLogger.logAuditEntryAsync({
                requestInfo,
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

    describe('Gap 11: Bulk data export runner has no audit logging', () => {
        /**
         * The BulkDataExportRunner processes export jobs and writes data to S3.
         * It queries the database for potentially large amounts of PHI but has
         * no AuditLogger dependency. If an export job is hijacked or misconfigured
         * to export cross-tenant data, there is no per-resource audit trail.
         */
        test('bulk data export runner must have audit logging for exported resources', () => {
            const fs = require('fs');
            const source = fs.readFileSync(
                require.resolve('../../../../operations/export/script/bulkDataExportRunner'),
                'utf8'
            );

            // The export runner processes each resource and writes to S3.
            // It MUST have an auditLogger to record which resources were exported.
            expect(source).toContain('auditLogger');
        });
    });

    describe('Gap 12: Audit event must capture tenant/owner context', () => {
        /**
         * For cross-tenant breach detection, audit events must record which
         * tenant's data was accessed. The current audit event creation uses
         * hardcoded 'bwell' security tags rather than the actual resource owner.
         */
        test('audit events should record the actual resource owner, not just hardcoded bwell', async () => {
            const auditLogger = createAuditLogger();

            const requestInfo = createMockRequestInfo({
                scope: 'user/*.read access/tenant-b.*'
            });

            await auditLogger.logAuditEntryAsync({
                requestInfo,
                base_version: '4_0_0',
                resourceType: 'Patient',
                operation: 'read',
                args: {},
                ids: ['patient-in-tenant-a']
            });

            const auditEvent = auditLogger.queue[0].doc;

            // The security tags on the audit event itself should NOT just be hardcoded 'bwell'.
            // They should reflect the actual tenant context so cross-tenant access
            // can be detected by querying audit events.
            // Currently hardcoded: { system: SecurityTagSystem.owner, code: 'bwell' }
            // Should be: the actual owner of the accessed resource, or the accessor's tenant
            const ownerTag = auditEvent.meta.security.find(
                s => s.system === 'https://www.icanbwell.com/owner'
            );
            // CORRECT behavior: owner tag should NOT be hardcoded to 'bwell'
            // for all audit events regardless of context. It should reflect
            // the accessor's tenant or be parameterized.
            expect(ownerTag.code).not.toBe('bwell');
        });
    });

    describe('Gap 13: Request abort must still produce audit event', () => {
        /**
         * If a client aborts a request after data has been read from the database
         * but before the response finishes, the postRequestProcessor tasks
         * (including audit logging) may not execute because they are queued
         * for after the response completes.
         */
        test('audit logging should not depend solely on postRequestProcessor for security events', () => {
            const fs = require('fs');
            const searchByIdSource = fs.readFileSync(
                require.resolve('../../../../operations/searchById/searchById'),
                'utf8'
            );

            // The audit event is added via postRequestProcessor.add() which runs
            // after the response. If the request is aborted, these may not fire.
            // For a resource that was actually READ from the DB, the audit event
            // should be guaranteed to persist, not conditional on response completion.
            //
            // Count how audit logging is invoked - it should have a synchronous
            // or guaranteed-delivery mechanism, not just postRequestProcessor
            const auditCallsViaPostProcessor = (searchByIdSource.match(/postRequestProcessor\.add/g) || []).length;
            const directAuditCalls = (searchByIdSource.match(/auditLogger\.logAuditEntryAsync/g) || []).length;

            // If ALL audit calls go through postRequestProcessor, aborted requests
            // lose their audit trail. There should be at least one direct/guaranteed path.
            // This test documents the gap: all audit is deferred and lossy.
            expect(directAuditCalls).toBeGreaterThan(auditCallsViaPostProcessor);
        });
    });
});
