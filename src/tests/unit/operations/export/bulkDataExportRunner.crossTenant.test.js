const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

jest.mock('../../../../operations/common/logging', () => {
    const { jest: j } = require('@jest/globals');
    return {
        logInfo: j.fn(),
        logError: j.fn(),
        logDebug: j.fn(),
        logWarn: j.fn()
    };
});

const { BulkDataExportRunner } = require('../../../../operations/export/script/bulkDataExportRunner');
const { DatabaseQueryFactory } = require('../../../../dataLayer/databaseQueryFactory');
const { DatabaseExportManager } = require('../../../../dataLayer/databaseExportManager');
const { PatientFilterManager } = require('../../../../fhir/patientFilterManager');
const { DatabaseAttachmentManager } = require('../../../../dataLayer/databaseAttachmentManager');
const { Base64DataManager } = require('../../../../dataLayer/base64DataManager');
const { R4SearchQueryCreator } = require('../../../../operations/query/r4');
const { PatientQueryCreator } = require('../../../../operations/common/patientQueryCreator');
const { EnrichmentManager } = require('../../../../enrich/enrich');
const { ResourceLocatorFactory } = require('../../../../operations/common/resourceLocatorFactory');
const { R4ArgsParser } = require('../../../../operations/query/r4ArgsParser');
const { SearchManager } = require('../../../../operations/search/searchManager');
const { S3Client } = require('../../../../utils/s3Client');
const { PostSaveProcessor } = require('../../../../dataLayer/postSaveProcessor');
const { BulkExportEventProducer } = require('../../../../utils/bulkExportEventProducer');
const { SecurityTagSystem } = require('../../../../utils/securityTagSystem');

function createMockInstance(ClassType) {
    return Object.create(ClassType.prototype);
}

/**
 * CROSS-TENANT PHI LEAKAGE TESTS FOR BULK EXPORT
 *
 * These tests verify correct tenant isolation behavior in bulk data export operations.
 * They are written to FAIL against the current code where vulnerabilities exist,
 * asserting the CORRECT (secure) behavior that should be implemented.
 */
describe('BulkDataExportRunner - Cross-Tenant PHI Leakage', () => {
    let runner;
    let mocks;

    beforeEach(() => {
        mocks = {
            databaseQueryFactory: createMockInstance(DatabaseQueryFactory),
            databaseExportManager: createMockInstance(DatabaseExportManager),
            patientFilterManager: createMockInstance(PatientFilterManager),
            databaseAttachmentManager: createMockInstance(DatabaseAttachmentManager),
            base64DataManager: createMockInstance(Base64DataManager),
            r4SearchQueryCreator: createMockInstance(R4SearchQueryCreator),
            patientQueryCreator: createMockInstance(PatientQueryCreator),
            enrichmentManager: createMockInstance(EnrichmentManager),
            resourceLocatorFactory: createMockInstance(ResourceLocatorFactory),
            r4ArgsParser: createMockInstance(R4ArgsParser),
            searchManager: createMockInstance(SearchManager),
            s3Client: createMockInstance(S3Client),
            postSaveProcessor: createMockInstance(PostSaveProcessor),
            bulkExportEventProducer: createMockInstance(BulkExportEventProducer),
            exportStatusId: 'export-status-uuid-tenant-a',
            patientReferenceBatchSize: 100,
            fetchResourceBatchSize: 50,
            uploadPartSize: 5 * 1024 * 1024,
            requestId: 'req-tenant-a'
        };

        // Setup mocks
        mocks.databaseExportManager.getExportStatusResourceWithId = jest.fn();
        mocks.databaseExportManager.updateExportStatusAsync = jest.fn().mockResolvedValue(undefined);
        mocks.postSaveProcessor.afterSaveAsync = jest.fn().mockResolvedValue(undefined);
        mocks.postSaveProcessor.flushAsync = jest.fn().mockResolvedValue(undefined);
        mocks.bulkExportEventProducer.produce = jest.fn().mockResolvedValue(undefined);
        mocks.r4SearchQueryCreator.appendAndSimplifyQuery = jest.fn(({ query, andQuery }) => ({
            ...query, ...andQuery
        }));
        mocks.r4ArgsParser.parseArgs = jest.fn().mockReturnValue({ headers: {}, base_version: '4_0_0' });
        mocks.searchManager.constructQueryAsync = jest.fn().mockResolvedValue({ query: {} });
        mocks.s3Client.uploadAsync = jest.fn().mockResolvedValue(undefined);
        mocks.s3Client.getPublicFilePath = jest.fn((path) => `s3://bucket/${path}`);
        mocks.s3Client.uploadEmptyFileAsync = jest.fn().mockResolvedValue(undefined);
        mocks.s3Client.createMultiPartUploadAsync = jest.fn().mockResolvedValue('upload-id-1');
        mocks.s3Client.uploadPartAsync = jest.fn().mockResolvedValue({ ETag: 'etag1' });
        mocks.s3Client.completeMultiPartUploadAsync = jest.fn().mockResolvedValue(undefined);
        mocks.s3Client.abortMultiPartUploadAsync = jest.fn().mockResolvedValue(undefined);
        mocks.patientFilterManager.getAllPatientOrPersonRelatedResources = jest.fn().mockReturnValue(['Patient', 'Observation']);
        mocks.patientFilterManager.getPatientPropertyForResource = jest.fn().mockReturnValue('subject.reference');
        mocks.patientFilterManager.getPatientPropertyForPersonScopedResource = jest.fn().mockReturnValue(null);

        runner = new BulkDataExportRunner(mocks);
    });

    // =========================================================================
    // VULNERABILITY 1: getQueryForExport uses wrong resourceType for security
    // tag filtering. It passes 'ExportStatus' to constructQueryAsync instead
    // of the actual resource type being exported.
    //
    // File: src/operations/export/script/bulkDataExportRunner.js, lines 332-361
    // Severity: HIGH
    // Exploitation: The security tag query built for 'ExportStatus' may use
    // different access index settings than the actual resource type. If a
    // resource type uses access indexes (_access field optimization) but
    // ExportStatus does not, the security filter could be built incorrectly,
    // potentially allowing data from other tenants to leak through.
    // =========================================================================
    describe('VULN-1: getQueryForExport must use actual resourceType for security filtering', () => {
        test('constructQueryAsync should be called with the actual resourceType, not ExportStatus', async () => {
            const searchParams = new URLSearchParams();
            searchParams.set('base_version', '4_0_0');

            await runner.getQueryForExport({
                user: 'tenantA-client',
                scope: 'user/*.read access/tenantA.*',
                searchParams
            });

            // CORRECT behavior: constructQueryAsync should be called with
            // resourceType matching the resource being exported (or at least
            // not hardcoded to 'ExportStatus').
            // The current code passes resourceType: 'ExportStatus' which means
            // the access index optimization path may not be used correctly for
            // resources like Patient, Observation, etc.
            const callArgs = mocks.searchManager.constructQueryAsync.mock.calls[0][0];
            expect(callArgs.resourceType).not.toBe('ExportStatus');
        });

        test('query should include security tag filter matching the tenant access code', async () => {
            // Setup: constructQueryAsync returns an EMPTY query (simulating
            // the broken behavior where ExportStatus resourceType is used and
            // the security filtering is not correctly applied for the actual
            // resource being exported)
            mocks.searchManager.constructQueryAsync = jest.fn().mockResolvedValue({
                query: {}
            });

            const searchParams = new URLSearchParams();
            searchParams.set('base_version', '4_0_0');

            const query = await runner.getQueryForExport({
                user: 'tenantA-client',
                scope: 'user/*.read access/tenantA.*',
                searchParams
            });

            // CORRECT behavior: The resulting query MUST have security tag
            // filtering to prevent cross-tenant data leakage, regardless of
            // what constructQueryAsync returns. The export runner should
            // independently ensure tenant scoping exists in the query.
            const queryStr = JSON.stringify(query);
            const hasSecurityFilter =
                queryStr.includes('meta.security') ||
                queryStr.includes('_access') ||
                queryStr.includes(SecurityTagSystem.access);
            expect(hasSecurityFilter).toBe(true);
        });
    });

    // =========================================================================
    // VULNERABILITY 2: processResourceAsync does not independently verify
    // tenant security tags. It receives a query from getQueryForExport built
    // for 'ExportStatus' and applies it directly to resource collections
    // without verifying the query contains appropriate tenant filtering for
    // that specific resource type.
    //
    // File: src/operations/export/script/bulkDataExportRunner.js, lines 792-911
    // Severity: CRITICAL
    // Exploitation: If constructQueryAsync's security tag query is incorrect
    // for the actual resource type (see VULN-1), processResourceAsync will
    // execute an unfiltered or weakly-filtered query against the resource
    // collection, potentially returning all tenants' data.
    // =========================================================================
    describe('VULN-2: processResourceAsync must verify security tags per resource type', () => {
        test('query applied to resource collection must contain access/security filter', async () => {
            // Setup a mock that captures the query used in the database find call
            const findQuery = {};
            const mockCursor = {
                hasNext: jest.fn().mockResolvedValue(false)
            };
            const mockCollection = {
                find: jest.fn((query) => {
                    Object.assign(findQuery, query);
                    return mockCursor;
                })
            };
            const mockDb = {
                collection: jest.fn().mockReturnValue(mockCollection),
                command: jest.fn().mockResolvedValue({ avgObjSize: 1000 })
            };
            const mockResourceLocator = {
                getDatabaseConnectionAsync: jest.fn().mockResolvedValue(mockDb)
            };
            mocks.resourceLocatorFactory.createResourceLocator = jest.fn().mockReturnValue(mockResourceLocator);

            runner.exportStatusResource = {
                output: [],
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'tenantA' }
                    ]
                }
            };
            runner.baseS3Folder = 'exports/tenantA/export-status-uuid-tenant-a';

            // Simulate a query WITHOUT proper security tag filtering
            // (which is what happens due to VULN-1)
            const insecureQuery = {};

            await runner.processResourceAsync({
                resourceType: 'Patient',
                query: insecureQuery
            });

            // CORRECT behavior: the query sent to the database MUST include
            // a security tag filter (meta.security or _access) to scope
            // results to only the requesting tenant's data.
            const queryUsed = mockCollection.find.mock.calls[0][0];
            const queryStr = JSON.stringify(queryUsed);
            const hasSecurityFilter =
                queryStr.includes('meta.security') ||
                queryStr.includes('_access') ||
                queryStr.includes(SecurityTagSystem.access);

            expect(hasSecurityFilter).toBe(true);
        });
    });

    // =========================================================================
    // VULNERABILITY 3: ExportById (exportById.js) has no tenant ownership check.
    // getExportStatusResourceWithId fetches the export status resource by ID
    // only, without verifying the caller's access tags match those on the
    // ExportStatus resource.
    //
    // File: src/operations/export/exportById.js, lines 58-75
    // File: src/dataLayer/databaseExportManager.js, lines 46-69
    // Severity: CRITICAL
    // Exploitation: Tenant B can call GET /4_0_0/$export/<tenantA-export-id>
    // and receive Tenant A's export status, including S3 URLs to download
    // Tenant A's complete NDJSON export files.
    // =========================================================================
    describe('VULN-3: exportById must verify tenant ownership of ExportStatus', () => {
        test('should reject access when caller scope does not match ExportStatus access tags', async () => {
            // This tests the ExportByIdOperation class
            const { ExportByIdOperation } = require('../../../../operations/export/exportById');
            const { ScopesManager } = require('../../../../operations/security/scopesManager');
            const { FhirLoggingManager } = require('../../../../operations/common/fhirLoggingManager');

            const mockScopesManager = createMockInstance(ScopesManager);
            mockScopesManager.hasPatientScope = jest.fn().mockReturnValue(false);
            mockScopesManager.getAccessCodesFromScopes = jest.fn().mockReturnValue(['tenantB']);

            const mockFhirLoggingManager = createMockInstance(FhirLoggingManager);
            mockFhirLoggingManager.logOperationSuccessAsync = jest.fn().mockResolvedValue(undefined);
            mockFhirLoggingManager.logOperationFailureAsync = jest.fn().mockResolvedValue(undefined);

            const mockDatabaseExportManager = createMockInstance(DatabaseExportManager);
            // ExportStatus belongs to tenantA
            mockDatabaseExportManager.getExportStatusResourceWithId = jest.fn().mockResolvedValue({
                id: 'export-uuid-tenant-a',
                resourceType: 'ExportStatus',
                status: 'completed',
                meta: {
                    security: [
                        { system: 'https://www.icanbwell.com/owner', code: 'bwell' },
                        { system: SecurityTagSystem.access, code: 'tenantA' }
                    ]
                },
                output: [
                    { type: 'Patient', url: 's3://bucket/exports/tenantA/export-uuid-tenant-a/Patient.ndjson' }
                ],
                scope: 'user/*.read access/tenantA.*',
                user: 'tenantA-client'
            });

            const exportByIdOp = new ExportByIdOperation({
                scopesManager: mockScopesManager,
                fhirLoggingManager: mockFhirLoggingManager,
                databaseExportManager: mockDatabaseExportManager
            });

            // TenantB tries to access TenantA's export status
            const requestInfo = {
                requestId: 'req-from-tenant-b',
                scope: 'user/*.read access/tenantB.*',
                user: 'tenantB-client'
            };

            // CORRECT behavior: This should throw a ForbiddenError or NotFoundError
            // because tenantB does not have access to tenantA's export.
            // Currently, it returns the resource without checking access tags.
            await expect(
                exportByIdOp.exportByIdAsync({
                    requestInfo,
                    args: { id: 'export-uuid-tenant-a' }
                })
            ).rejects.toThrow();
        });
    });

    // =========================================================================
    // VULNERABILITY 4: S3 path structure is predictable/enumerable.
    // The S3 path pattern is: exports/{accessTags}/{exportStatusId}/
    // If a tenant knows another tenant's access tag name (e.g., "clientXYZ")
    // and can guess or enumerate export status IDs, they could potentially
    // construct direct S3 paths to another tenant's export files.
    //
    // File: src/operations/export/script/bulkDataExportRunner.js, line 243
    // Severity: MEDIUM
    // Exploitation: While the export status ID uses crypto.randomUUID() which
    // is unguessable, the S3 path exposes the tenant access tag name.
    // Combined with VULN-3 (reading another tenant's ExportStatus), the
    // attacker gets the complete S3 URL.
    // =========================================================================
    describe('VULN-4: S3 paths should not be derivable from tenant name alone', () => {
        test('baseS3Folder should use export-specific unique identifier not just access tag', async () => {
            runner.exportStatusResource = {
                status: 'accepted',
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'tenantA' }
                    ]
                },
                request: 'http://localhost/4_0_0/$export?_type=Patient',
                scope: 'user/*.read access/tenantA.*',
                user: 'tenantA-user',
                output: [],
                errors: []
            };

            // Simulate the folder computation from processAsync (lines 237-243)
            const accessTags = runner.exportStatusResource.meta.security
                .filter(s => s.system === SecurityTagSystem.access)
                .map(s => s.code);
            const computedFolder = `exports/${accessTags.join('_')}/${runner.exportStatusId}`;

            // CORRECT behavior: The S3 folder should NOT embed the plaintext
            // access tag in a predictable path pattern. An attacker who knows
            // the access tag "tenantA" can narrow their guessing attack to
            // exports/tenantA/ prefix. The folder should either:
            // 1. Use only the cryptographic export ID, or
            // 2. Include a per-export random token separate from the ID
            expect(computedFolder).not.toMatch(/^exports\/[^/]+\/[^/]+$/);
        });
    });

    // =========================================================================
    // VULNERABILITY 5: Buffer concatenation bug causes data loss/corruption
    // in multipart uploads (not cross-tenant, but data integrity issue that
    // could manifest as cross-export data mixing in concurrent scenarios).
    //
    // File: src/operations/export/script/bulkDataExportRunner.js, line 742
    // Severity: MEDIUM
    // Bug: `currentBatch.concat(multipartContext.previousBuffer)` returns a
    // new array but the result is DISCARDED. The previous buffer's records
    // are never actually included in the upload, causing data loss.
    // In concurrent export scenarios where the same collection is being
    // queried simultaneously, this could result in partial data from one
    // batch appearing in the wrong export if buffers are shared.
    // =========================================================================
    describe('VULN-5: Buffer concat bug causes data loss in multipart patient export', () => {
        test('previousBuffer data must be included in the uploaded batch', async () => {
            // Setup: Simulate the exportPatientDataAsync logic where previousBuffer exists
            const { S3MultiPartContext } = require('../../../../operations/export/script/s3MultiPartContext');

            const multipartContext = new S3MultiPartContext({
                resourceFilePath: 'exports/tenantA/export-123/Observation.ndjson'
            });

            // Simulate having a previous buffer with data
            multipartContext.previousBuffer = ['{"id":"prev-record-1"}', '{"id":"prev-record-2"}'];
            multipartContext.previousBatchSize = 2;
            multipartContext.uploadId = 'upload-id-1';
            multipartContext.readCount = 0;

            // Simulate the buffer concatenation logic from line 741-744
            const currentBatch = ['{"id":"new-record-1"}', '{"id":"new-record-2"}', '{"id":"new-record-3"}'];
            let currentBatchSize = 3;

            // This is the BUGGY code from line 742:
            // currentBatch.concat(multipartContext.previousBuffer);
            // Array.concat does NOT mutate in place - it returns a new array!
            const resultAfterBuggyConcat = currentBatch.concat(multipartContext.previousBuffer);
            // The buggy code does: currentBatch.concat(...) without assigning
            // so currentBatch still has only 3 items

            // CORRECT behavior: After merging, the batch should contain BOTH
            // the new records AND the previous buffer records
            // The uploaded data should include all 5 records (3 new + 2 previous)
            const expectedTotalSize = currentBatchSize + multipartContext.previousBatchSize;

            // In the current buggy code, currentBatch is never actually modified
            // so only 3 records get uploaded, losing the 2 previous records
            expect(currentBatch.length).toBe(expectedTotalSize);
        });

        test('currentBatchSize must account for previousBuffer size after merge', async () => {
            // The code at line 743 does:
            // currentBatchSize += multipartContext.previousBatchSize;
            // But since the concat on line 742 had no effect, this size
            // is now WRONG - it says there are 5 items but the array only has 3.
            // This means currentBatch.slice(0, currentBatchSize) on line 752
            // will include undefined entries or go out of bounds.

            const currentBatch = new Array(10); // pre-allocated
            currentBatch[0] = '{"id":"rec-1"}';
            currentBatch[1] = '{"id":"rec-2"}';
            currentBatch[2] = '{"id":"rec-3"}';
            let currentBatchSize = 3;

            const previousBuffer = ['{"id":"prev-1"}', '{"id":"prev-2"}'];
            const previousBatchSize = 2;

            // Simulate the buggy code path
            currentBatch.concat(previousBuffer); // BUG: result not assigned
            currentBatchSize += previousBatchSize; // Now says 5 but array unchanged

            // When we slice for upload (line 752): currentBatch.slice(0, 5)
            const uploadData = currentBatch.slice(0, currentBatchSize);

            // CORRECT behavior: all 5 entries should be defined strings
            // In buggy code, entries [3] and [4] will be undefined
            for (let i = 0; i < currentBatchSize; i++) {
                expect(uploadData[i]).toBeDefined();
                expect(typeof uploadData[i]).toBe('string');
            }
        });
    });

    // =========================================================================
    // VULNERABILITY 6: Export status update has no concurrency protection.
    // The updateExportStatusResource method reads and updates the
    // exportStatusResource instance variable without any locking. If two
    // concurrent calls to processResourceAsync or handlePatientExportAsync
    // complete simultaneously, one could overwrite the other's output entries.
    // More critically, there's no check that the exportStatusResource still
    // belongs to the same tenant between the initial read and the final update.
    //
    // File: src/operations/export/script/bulkDataExportRunner.js, lines 366-381
    // Severity: MEDIUM
    // Exploitation: A race condition between reading the ExportStatus and
    // updating it could allow export output entries to be written to a
    // stale/wrong ExportStatus document if the DB has been modified between
    // reads.
    // =========================================================================
    describe('VULN-6: Export status updates must use conditional write to prevent races', () => {
        test('updateExportStatusResource should use version/etag checking for optimistic concurrency', async () => {
            runner.exportStatusResource = {
                id: 'export-123',
                _uuid: 'export-uuid-123',
                status: 'in-progress',
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'tenantA' }
                    ],
                    versionId: '2',
                    lastUpdated: new Date()
                },
                output: [],
                errors: []
            };

            await runner.updateExportStatusResource();

            // CORRECT behavior: the update call should include a version check
            // (optimistic concurrency control) to prevent race conditions.
            // The update should fail if the resource was modified since last read.
            const updateCall = mocks.databaseExportManager.updateExportStatusAsync.mock.calls[0][0];

            // The update should pass a version condition or use findOneAndUpdate
            // with a filter that includes the expected versionId
            expect(updateCall).toHaveProperty('expectedVersion');
        });
    });

    // =========================================================================
    // VULNERABILITY 7: getQueryForExport does not pass useAccessIndex flag.
    // When constructQueryAsync is called, it doesn't receive useAccessIndex
    // parameter. The securityTagManager.getQueryWithSecurityTags method
    // behaves differently based on this flag - without it, it may generate
    // a less efficient query that on certain resource types could miss the
    // _access index optimization and fall back to scanning meta.security array.
    // On collections without proper compound indexes, this scan could be
    // incomplete or miss documents.
    //
    // File: src/operations/export/script/bulkDataExportRunner.js, line 342
    // Severity: LOW (performance) to MEDIUM (correctness on unindexed collections)
    // =========================================================================
    describe('VULN-7: getQueryForExport should pass correct resource type and useAccessIndex', () => {
        test('constructQueryAsync should receive useAccessIndex=true for indexed resource types', async () => {
            const searchParams = new URLSearchParams();
            searchParams.set('base_version', '4_0_0');

            await runner.getQueryForExport({
                user: 'tenantA-client',
                scope: 'user/*.read access/tenantA.*',
                searchParams
            });

            const callArgs = mocks.searchManager.constructQueryAsync.mock.calls[0][0];

            // CORRECT behavior: useAccessIndex should be explicitly set
            // so that the security tag query can use the optimized _access
            // field when available for the target resource type.
            expect(callArgs).toHaveProperty('useAccessIndex');
            expect(callArgs.useAccessIndex).toBe(true);
        });
    });
});
