const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

jest.mock('../../../../operations/common/logging', () => {
    const { jest: j } = require('@jest/globals');
    return {
        logInfo: j.fn(),
        logError: j.fn(),
        logDebug: j.fn()
    };
});

const { ExportByIdOperation } = require('../../../../operations/export/exportById');
const { DatabaseExportManager } = require('../../../../dataLayer/databaseExportManager');
const { ScopesManager } = require('../../../../operations/security/scopesManager');
const { ConfigManager } = require('../../../../utils/configManager');
const { PatientFilterManager } = require('../../../../fhir/patientFilterManager');
const { FhirLoggingManager } = require('../../../../operations/common/fhirLoggingManager');
const { SecurityTagSystem } = require('../../../../utils/securityTagSystem');

function createMockInstance(ClassType) {
    return Object.create(ClassType.prototype);
}

/**
 * CROSS-TENANT PHI LEAKAGE TESTS FOR EXPORT-BY-ID OPERATION
 *
 * These tests verify that one tenant cannot access another tenant's export
 * status resources (which contain S3 download URLs for the exported PHI data).
 *
 * All tests assert CORRECT (secure) behavior and are expected to FAIL against
 * the current vulnerable code.
 */
describe('ExportByIdOperation - Cross-Tenant PHI Leakage', () => {
    let exportByIdOp;
    let mockScopesManager;
    let mockFhirLoggingManager;
    let mockDatabaseExportManager;

    beforeEach(() => {
        // Use the real ScopesManager rather than re-implementing its access-check logic in a
        // mock: a hand-rolled mock previously diverged from the production owner+access check,
        // which is exactly what masked the cross-tenant regression these tests exist to catch.
        mockScopesManager = new ScopesManager({
            configManager: new ConfigManager(),
            patientFilterManager: new PatientFilterManager()
        });

        mockFhirLoggingManager = createMockInstance(FhirLoggingManager);
        mockFhirLoggingManager.logOperationSuccessAsync = jest.fn().mockResolvedValue(undefined);
        mockFhirLoggingManager.logOperationFailureAsync = jest.fn().mockResolvedValue(undefined);

        mockDatabaseExportManager = createMockInstance(DatabaseExportManager);

        exportByIdOp = new ExportByIdOperation({
            scopesManager: mockScopesManager,
            fhirLoggingManager: mockFhirLoggingManager,
            databaseExportManager: mockDatabaseExportManager
        });
    });

    // =========================================================================
    // VULNERABILITY: No tenant access verification on ExportStatus retrieval
    //
    // File: src/operations/export/exportById.js, lines 58-75
    // File: src/dataLayer/databaseExportManager.js, lines 46-69
    //
    // The exportByIdAsync method retrieves an ExportStatus resource by ID
    // and returns it to the caller without checking if the caller's access
    // scopes match the resource's security tags. This allows any authenticated
    // user to retrieve any tenant's export status (containing S3 URLs to
    // complete PHI datasets).
    //
    // Severity: CRITICAL
    //
    // Exploitation scenario:
    // 1. TenantA triggers a bulk export -> gets export ID in response
    // 2. TenantB discovers/guesses/enumerates the export ID
    //    (or obtains it from logs, error messages, etc.)
    // 3. TenantB calls GET /4_0_0/$export/<tenantA-export-id>
    // 4. Server returns TenantA's ExportStatus with S3 URLs
    // 5. TenantB downloads TenantA's entire PHI dataset from S3
    // =========================================================================

    test('should deny access when caller has different access tag than ExportStatus owner', async () => {
        // ExportStatus belongs to tenantA
        mockDatabaseExportManager.getExportStatusResourceWithId = jest.fn().mockResolvedValue({
            id: 'export-tenantA-123',
            _uuid: 'export-tenantA-uuid-123',
            resourceType: 'ExportStatus',
            status: 'completed',
            meta: {
                security: [
                    { system: 'https://www.icanbwell.com/owner', code: 'bwell' },
                    { system: SecurityTagSystem.access, code: 'tenantA' }
                ]
            },
            output: [
                { type: 'Patient', url: 's3://bucket/exports/tenantA/export-tenantA-uuid-123/Patient.ndjson' },
                { type: 'Observation', url: 's3://bucket/exports/tenantA/export-tenantA-uuid-123/Observation.ndjson' }
            ],
            scope: 'user/*.read access/tenantA.*',
            user: 'tenantA-service-account'
        });

        // TenantB caller
        const requestInfo = {
            requestId: 'req-from-tenantB',
            scope: 'user/*.read access/tenantB.*',
            user: 'tenantB-service-account'
        };

        // CORRECT behavior: should throw the same "doesn't exists" NotFoundError used for a
        // missing resource (statusCode 404), not ForbiddenError. Reusing the same error as a
        // missing resource avoids letting a caller distinguish "exists, not mine" from "does
        // not exist" (NB: this repo's ServerError base class resets its own prototype in its
        // constructor, so `instanceof`/class-based matchers don't work on these errors — assert
        // on statusCode/message instead).
        await expect(
            exportByIdOp.exportByIdAsync({
                requestInfo,
                args: { id: 'export-tenantA-123' }
            })
        ).rejects.toMatchObject({ statusCode: 404, message: expect.stringContaining("doesn't exists") });
    });

    test('should allow tenant to read back their own export status (owner tag is always bwell)', async () => {
        // ExportStatus is always created with a platform-level owner tag of 'bwell' regardless
        // of the triggering tenant (see ExportManager.generateExportStatusResourceAsync); only
        // the access tag identifies the owning tenant. A caller polling their own export with
        // just their tenant's access scope must not be denied for lacking the 'bwell' owner scope.
        mockDatabaseExportManager.getExportStatusResourceWithId = jest.fn().mockResolvedValue({
            id: 'export-tenantA-self',
            _uuid: 'export-tenantA-uuid-self',
            resourceType: 'ExportStatus',
            status: 'completed',
            meta: {
                security: [
                    { system: 'https://www.icanbwell.com/owner', code: 'bwell' },
                    { system: SecurityTagSystem.access, code: 'tenantA' }
                ]
            },
            output: [
                { type: 'Patient', url: 's3://bucket/exports/tenantA/export-tenantA-uuid-self/Patient.ndjson' }
            ],
            scope: 'user/*.read access/tenantA.*',
            user: 'tenantA-service-account'
        });

        const requestInfo = {
            requestId: 'req-tenantA-self',
            scope: 'user/*.read access/tenantA.*',
            user: 'tenantA-service-account'
        };

        const result = await exportByIdOp.exportByIdAsync({
            requestInfo,
            args: { id: 'export-tenantA-self' }
        });

        expect(result).toBeDefined();
        expect(result.id).toBe('export-tenantA-self');
    });

    test('should deny access when caller has no access scopes at all', async () => {
        mockDatabaseExportManager.getExportStatusResourceWithId = jest.fn().mockResolvedValue({
            id: 'export-tenantA-456',
            _uuid: 'export-tenantA-uuid-456',
            resourceType: 'ExportStatus',
            status: 'completed',
            meta: {
                security: [
                    { system: SecurityTagSystem.access, code: 'tenantA' }
                ]
            },
            output: [
                { type: 'Patient', url: 's3://bucket/exports/tenantA/export-tenantA-uuid-456/Patient.ndjson' }
            ],
            scope: 'user/*.read access/tenantA.*',
            user: 'tenantA-client'
        });

        // Caller with no access scope (should never happen in production, but defense in depth)
        const requestInfo = {
            requestId: 'req-no-scope',
            scope: 'user/*.read',
            user: 'anonymous-client'
        };

        await expect(
            exportByIdOp.exportByIdAsync({
                requestInfo,
                args: { id: 'export-tenantA-456' }
            })
        ).rejects.toThrow();
    });

    test('should allow access when caller access tag matches ExportStatus access tag', async () => {
        mockDatabaseExportManager.getExportStatusResourceWithId = jest.fn().mockResolvedValue({
            id: 'export-tenantA-789',
            _uuid: 'export-tenantA-uuid-789',
            resourceType: 'ExportStatus',
            status: 'completed',
            meta: {
                security: [
                    { system: SecurityTagSystem.access, code: 'tenantA' }
                ]
            },
            output: [
                { type: 'Patient', url: 's3://bucket/exports/tenantA/export-tenantA-uuid-789/Patient.ndjson' }
            ],
            scope: 'user/*.read access/tenantA.*',
            user: 'tenantA-client'
        });

        // Same tenant calling
        const requestInfo = {
            requestId: 'req-tenantA',
            scope: 'user/*.read access/tenantA.*',
            user: 'tenantA-client'
        };

        // CORRECT behavior: should succeed for matching tenant
        const result = await exportByIdOp.exportByIdAsync({
            requestInfo,
            args: { id: 'export-tenantA-789' }
        });

        expect(result).toBeDefined();
        expect(result.id).toBe('export-tenantA-789');
    });

    test('should deny access even if caller has wildcard (*) resource scope but wrong access tag', async () => {
        // Wildcard resource scope (user/*.*) should NOT bypass tenant isolation
        mockDatabaseExportManager.getExportStatusResourceWithId = jest.fn().mockResolvedValue({
            id: 'export-tenantA-wild',
            _uuid: 'export-tenantA-uuid-wild',
            resourceType: 'ExportStatus',
            status: 'in-progress',
            meta: {
                security: [
                    { system: SecurityTagSystem.access, code: 'tenantA' }
                ]
            },
            output: [],
            scope: 'user/*.* access/tenantA.*',
            user: 'tenantA-admin'
        });

        const requestInfo = {
            requestId: 'req-tenantC-wild',
            scope: 'user/*.* access/tenantC.*',
            user: 'tenantC-admin'
        };

        // Even with full resource-level wildcard, tenant isolation must hold
        await expect(
            exportByIdOp.exportByIdAsync({
                requestInfo,
                args: { id: 'export-tenantA-wild' }
            })
        ).rejects.toMatchObject({ statusCode: 404, message: expect.stringContaining("doesn't exists") });
    });

    test('should use security-tag-filtered query to fetch ExportStatus, not raw ID lookup', async () => {
        // The fundamental fix: getExportStatusResourceWithId should include
        // the caller's access tags in the query filter, not just the ID.
        mockDatabaseExportManager.getExportStatusResourceWithId = jest.fn().mockResolvedValue(null);

        const requestInfo = {
            requestId: 'req-tenantB-attempt',
            scope: 'user/*.read access/tenantB.*',
            user: 'tenantB-client'
        };

        // When fetching by ID with tenantB's scope, and the resource belongs
        // to tenantA, the query should filter it out (return null -> NotFoundError)
        try {
            await exportByIdOp.exportByIdAsync({
                requestInfo,
                args: { id: 'export-tenantA-123' }
            });
        } catch (e) {
            // Expected to throw NotFoundError or ForbiddenError
        }

        // CORRECT behavior: The database query should include the caller's
        // access tags as a filter condition, not just the ID.
        // Check that getExportStatusResourceWithId was called with security filter
        const callArgs = mockDatabaseExportManager.getExportStatusResourceWithId.mock.calls[0][0];

        // The method should receive either:
        // - accessTags/securityTags to filter by, OR
        // - scope/user info to derive them from
        const hasSecurityFilter =
            callArgs.accessTags ||
            callArgs.securityTags ||
            callArgs.scope ||
            callArgs.user;

        expect(hasSecurityFilter).toBeTruthy();
    });

    test('ExportStatus output URLs should not be returned for cross-tenant requests', async () => {
        // Even if the lookup somehow returns a resource, the S3 URLs in the
        // output should be stripped or the entire response denied.
        mockDatabaseExportManager.getExportStatusResourceWithId = jest.fn().mockResolvedValue({
            id: 'export-tenantA-leaked',
            resourceType: 'ExportStatus',
            status: 'completed',
            meta: {
                security: [
                    { system: SecurityTagSystem.access, code: 'tenantA' }
                ]
            },
            output: [
                { type: 'Patient', url: 's3://bucket/exports/tenantA/export-leaked/Patient.ndjson' },
                { type: 'Condition', url: 's3://bucket/exports/tenantA/export-leaked/Condition.ndjson' }
            ],
            scope: 'user/*.read access/tenantA.*',
            user: 'tenantA-client'
        });

        const requestInfo = {
            requestId: 'req-attacker',
            scope: 'user/*.read access/attacker.*',
            user: 'attacker-client'
        };

        // CORRECT behavior: Either throw or return without S3 URLs
        let result;
        let threw = false;
        try {
            result = await exportByIdOp.exportByIdAsync({
                requestInfo,
                args: { id: 'export-tenantA-leaked' }
            });
        } catch (e) {
            threw = true;
        }

        // Must either throw (preferred) or not expose S3 URLs
        if (!threw) {
            // If it doesn't throw, it MUST NOT contain the output URLs
            expect(result.output).toBeUndefined();
        } else {
            expect(threw).toBe(true);
        }
    });
});
