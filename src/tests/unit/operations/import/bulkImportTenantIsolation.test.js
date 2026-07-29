/**
 * Security tests for cross-tenant data injection via bulk import.
 *
 * Vulnerability: The bulk import pipeline reads NDJSON resources from S3 and
 * writes them to the database. If imported resources' meta.security tags are
 * not validated/overwritten to match the importing tenant, an attacker can
 * inject resources into OTHER tenants' data spaces by uploading NDJSON files
 * that carry arbitrary owner/access security tags.
 *
 * These tests assert CORRECT tenant-isolation behavior so they FAIL on the
 * current code which lacks these protections.
 */
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

jest.mock('../../../../utils/assertType', () => ({
    assertTypeEquals: jest.fn(),
    assertIsValid: jest.fn()
}));

const { BulkImportConsumerRunner } = require('../../../../operations/import/bulkImportConsumerRunner');
const { SecurityTagSystem } = require('../../../../utils/securityTagSystem');

/**
 * Creates a mock ConfigManager with standard bulk import settings
 */
function createMockConfigManager(overrides = {}) {
    const config = {
        bulkImportAllowedS3Buckets: ['allowed-bucket'],
        awsRegion: 'us-east-1',
        bulkImportMaxLineSizeMb: 10,
        bulkImportRangeSizeMb: 64,
        kafkaV2EnableEvents: true,
        kafkaBulkImportEventTopic: 'test-import-events',
        ...overrides
    };
    const obj = {};
    for (const [key, value] of Object.entries(config)) {
        Object.defineProperty(obj, key, { get: () => value, configurable: true });
    }
    return obj;
}

/**
 * Creates a valid ImportRangeRequested Kafka message
 */
function createKafkaMessage({ taskId, filepath, scope, user, byteRangeStart = 0, byteRangeEnd = 1024, fileSize = 1024 }) {
    return {
        key: `${taskId}-0-0`,
        value: JSON.stringify({
            specversion: '1.0',
            id: 'test-event-id',
            source: 'https://www.icanbwell.com/fhir-server',
            type: 'ImportRangeRequested',
            datacontenttype: 'application/json',
            data: {
                taskId,
                filepath,
                byteRangeStart,
                byteRangeEnd,
                fileSize,
                rangeIndex: 0,
                totalRanges: 1,
                requestId: 'req-123',
                scope,
                user
            }
        }),
        headers: []
    };
}

/**
 * Creates a FHIR resource with specific meta.security tags (simulating
 * an attacker-crafted NDJSON line)
 */
function createResourceWithSecurityTags({ resourceType, id, ownerCode, accessCode, sourceAssigningAuthority }) {
    const security = [];
    if (ownerCode) {
        security.push({ system: SecurityTagSystem.owner, code: ownerCode });
    }
    if (accessCode) {
        security.push({ system: SecurityTagSystem.access, code: accessCode });
    }
    if (sourceAssigningAuthority) {
        security.push({ system: SecurityTagSystem.sourceAssigningAuthority, code: sourceAssigningAuthority });
    }
    return {
        resourceType,
        id,
        meta: {
            security,
            source: ownerCode || 'unknown'
        }
    };
}

describe('Bulk Import - Cross-Tenant Data Injection Prevention', () => {
    let consumerRunner;
    let mockDatabaseQueryFactory;
    let mockDatabaseUpdateFactory;
    let mockS3NdjsonReader;
    let mockConfigManager;
    let mockInsertOneAsync;
    let mockReplaceOneAsync;
    let mockUpdateOneAsync;

    beforeEach(() => {
        mockConfigManager = createMockConfigManager();

        mockInsertOneAsync = jest.fn().mockResolvedValue(undefined);
        mockReplaceOneAsync = jest.fn().mockResolvedValue(undefined);
        mockUpdateOneAsync = jest.fn().mockResolvedValue(undefined);

        mockDatabaseQueryFactory = {
            createQuery: jest.fn().mockReturnValue({
                findOneAsync: jest.fn().mockResolvedValue({
                    id: 'task-1',
                    status: 'requested',
                    meta: {
                        security: [
                            { system: SecurityTagSystem.owner, code: 'tenantA' },
                            { system: SecurityTagSystem.access, code: 'tenantA' },
                            { system: SecurityTagSystem.sourceAssigningAuthority, code: 'tenantA' }
                        ]
                    },
                    clone: function () {
                        return {
                            ...this,
                            meta: { ...this.meta, security: [...this.meta.security] }
                        };
                    }
                })
            })
        };

        mockDatabaseUpdateFactory = {
            createDatabaseUpdateManager: jest.fn().mockReturnValue({
                insertOneAsync: mockInsertOneAsync,
                updateOneAsync: mockUpdateOneAsync,
                replaceOneAsync: mockReplaceOneAsync
            })
        };

        mockS3NdjsonReader = {
            readNdjsonAsync: jest.fn()
        };

        consumerRunner = new BulkImportConsumerRunner({
            configManager: mockConfigManager,
            databaseQueryFactory: mockDatabaseQueryFactory,
            databaseUpdateFactory: mockDatabaseUpdateFactory,
            s3NdjsonReader: mockS3NdjsonReader
        });
    });

    describe('Security tag validation on imported resources', () => {
        test('valid resource belonging to importing tenant is written to the database', async () => {
            // A resource with correct tenant security tags should be persisted.
            // This test FAILS because the consumer does not write resources at all
            // (the processing loop is a no-op).
            const validResource = createResourceWithSecurityTags({
                resourceType: 'Patient',
                id: 'valid-patient-1',
                ownerCode: 'tenantA',
                accessCode: 'tenantA',
                sourceAssigningAuthority: 'tenantA'
            });

            async function* fakeReader() {
                yield { lineNumber: 1, resource: validResource };
            }
            mockS3NdjsonReader.readNdjsonAsync.mockReturnValue(fakeReader());

            const message = createKafkaMessage({
                taskId: 'task-1',
                filepath: 's3://allowed-bucket/valid-data.ndjson',
                scope: 'user/*.* access/tenantA.*',
                user: 'tenantA-admin'
            });

            await consumerRunner.handleMessageAsync(message);

            // The consumer MUST write the valid resource to the database
            const totalWrites = mockInsertOneAsync.mock.calls.length +
                mockReplaceOneAsync.mock.calls.length;
            expect(totalWrites).toBeGreaterThan(0);
        });

        test('resource with foreign owner tag is rejected and not persisted', async () => {
            // ATTACK: Attacker uploads NDJSON with owner tag belonging to tenantB
            // while the import job belongs to tenantA.
            // This test FAILS because the consumer processes the resource without
            // any security tag validation (no-op loop means no rejection logic).
            const maliciousResource = createResourceWithSecurityTags({
                resourceType: 'Patient',
                id: 'injected-patient-1',
                ownerCode: 'tenantB',
                accessCode: 'tenantB',
                sourceAssigningAuthority: 'tenantB'
            });

            const validResource = createResourceWithSecurityTags({
                resourceType: 'Patient',
                id: 'valid-patient-2',
                ownerCode: 'tenantA',
                accessCode: 'tenantA',
                sourceAssigningAuthority: 'tenantA'
            });

            async function* fakeReader() {
                yield { lineNumber: 1, resource: maliciousResource };
                yield { lineNumber: 2, resource: validResource };
            }
            mockS3NdjsonReader.readNdjsonAsync.mockReturnValue(fakeReader());

            const message = createKafkaMessage({
                taskId: 'task-1',
                filepath: 's3://allowed-bucket/import-data.ndjson',
                scope: 'user/*.* access/tenantA.*',
                user: 'tenantA-admin'
            });

            await consumerRunner.handleMessageAsync(message);

            // The valid resource should be written, but the malicious one rejected
            const totalWrites = mockInsertOneAsync.mock.calls.length +
                mockReplaceOneAsync.mock.calls.length;

            // At minimum, the valid resource should be written
            expect(totalWrites).toBeGreaterThan(0);

            // No written document should have tenantB as owner
            const allWrittenDocs = [
                ...mockInsertOneAsync.mock.calls.map(c => c[0]?.doc || c[0]),
                ...mockReplaceOneAsync.mock.calls.map(c => c[0]?.doc || c[0])
            ].filter(Boolean);

            const crossTenantDocs = allWrittenDocs.filter(doc => {
                const security = doc?.meta?.security || [];
                return security.some(
                    s => s.system === SecurityTagSystem.owner && s.code === 'tenantB'
                );
            });
            expect(crossTenantDocs).toHaveLength(0);
        });

        test('imported resource security tags are overwritten to match importing tenant', async () => {
            // Even if the resource specifies a different owner, the system must
            // overwrite tags to the tenant that owns the import job.
            // This test FAILS because resources are never written (no processing).
            const resourceWithWrongOwner = createResourceWithSecurityTags({
                resourceType: 'Observation',
                id: 'obs-1',
                ownerCode: 'attackerTenant',
                accessCode: 'attackerTenant',
                sourceAssigningAuthority: 'attackerTenant'
            });

            async function* fakeReader() {
                yield { lineNumber: 1, resource: resourceWithWrongOwner };
            }
            mockS3NdjsonReader.readNdjsonAsync.mockReturnValue(fakeReader());

            const message = createKafkaMessage({
                taskId: 'task-1',
                filepath: 's3://allowed-bucket/data.ndjson',
                scope: 'user/*.* access/tenantA.*',
                user: 'tenantA-admin'
            });

            await consumerRunner.handleMessageAsync(message);

            // The system must either reject the resource or rewrite its security tags
            const allWrittenDocs = [
                ...mockInsertOneAsync.mock.calls.map(c => c[0]?.doc || c[0]),
                ...mockReplaceOneAsync.mock.calls.map(c => c[0]?.doc || c[0])
            ].filter(Boolean);

            // If it was written (rewrite approach), check tags are correct
            // If it was rejected (reject approach), totalWrites == 0 is acceptable
            // But the resource WAS yielded by the reader, so it must be processed
            // one way or the other - assert processing happened
            const totalWrites = mockInsertOneAsync.mock.calls.length +
                mockReplaceOneAsync.mock.calls.length;
            expect(totalWrites).toBeGreaterThan(0);

            for (const doc of allWrittenDocs) {
                const ownerTags = (doc.meta?.security || []).filter(
                    s => s.system === SecurityTagSystem.owner
                );
                expect(ownerTags).toHaveLength(1);
                expect(ownerTags[0].code).toBe('tenantA');
            }
        });

        test('resource with no meta.security is stamped with importing tenant tags before write', async () => {
            // Resources without security tags must be stamped with the importing
            // tenant's tags before being written.
            // This test FAILS because the consumer does not process/write resources.
            const resourceNoSecurity = {
                resourceType: 'Condition',
                id: 'cond-1',
                meta: {}
            };

            async function* fakeReader() {
                yield { lineNumber: 1, resource: resourceNoSecurity };
            }
            mockS3NdjsonReader.readNdjsonAsync.mockReturnValue(fakeReader());

            const message = createKafkaMessage({
                taskId: 'task-1',
                filepath: 's3://allowed-bucket/data.ndjson',
                scope: 'user/*.* access/tenantA.*',
                user: 'tenantA-admin'
            });

            await consumerRunner.handleMessageAsync(message);

            const totalWrites = mockInsertOneAsync.mock.calls.length +
                mockReplaceOneAsync.mock.calls.length;

            // The resource must be stamped and written
            expect(totalWrites).toBeGreaterThan(0);

            const allWrittenDocs = [
                ...mockInsertOneAsync.mock.calls.map(c => c[0]?.doc || c[0]),
                ...mockReplaceOneAsync.mock.calls.map(c => c[0]?.doc || c[0])
            ].filter(Boolean);

            for (const doc of allWrittenDocs) {
                const ownerTags = (doc.meta?.security || []).filter(
                    s => s.system === SecurityTagSystem.owner
                );
                expect(ownerTags).toHaveLength(1);
                expect(ownerTags[0].code).toBe('tenantA');
            }
        });

        test('resource with multiple owner tags is rejected', async () => {
            // Multiple owner tags are used to confuse access control logic.
            // This test FAILS because the consumer does not validate resources.
            const multiOwnerResource = {
                resourceType: 'MedicationRequest',
                id: 'medrq-1',
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'tenantA' },
                        { system: SecurityTagSystem.owner, code: 'tenantB' },
                        { system: SecurityTagSystem.access, code: 'tenantA' },
                        { system: SecurityTagSystem.access, code: 'tenantB' }
                    ],
                    source: 'tenantA'
                }
            };

            const validResource = createResourceWithSecurityTags({
                resourceType: 'Patient',
                id: 'valid-patient-multi',
                ownerCode: 'tenantA',
                accessCode: 'tenantA',
                sourceAssigningAuthority: 'tenantA'
            });

            async function* fakeReader() {
                yield { lineNumber: 1, resource: multiOwnerResource };
                yield { lineNumber: 2, resource: validResource };
            }
            mockS3NdjsonReader.readNdjsonAsync.mockReturnValue(fakeReader());

            const message = createKafkaMessage({
                taskId: 'task-1',
                filepath: 's3://allowed-bucket/data.ndjson',
                scope: 'user/*.* access/tenantA.*',
                user: 'tenantA-admin'
            });

            await consumerRunner.handleMessageAsync(message);

            // Valid resource should still be written
            const totalWrites = mockInsertOneAsync.mock.calls.length +
                mockReplaceOneAsync.mock.calls.length;
            expect(totalWrites).toBeGreaterThan(0);

            const allWrittenDocs = [
                ...mockInsertOneAsync.mock.calls.map(c => c[0]?.doc || c[0]),
                ...mockReplaceOneAsync.mock.calls.map(c => c[0]?.doc || c[0])
            ].filter(Boolean);

            // No document should have multiple owner tags
            for (const doc of allWrittenDocs) {
                const ownerTags = (doc.meta?.security || []).filter(
                    s => s.system === SecurityTagSystem.owner
                );
                expect(ownerTags.length).toBeLessThanOrEqual(1);
                if (ownerTags.length === 1) {
                    expect(ownerTags[0].code).toBe('tenantA');
                }
            }
        });
    });

    describe('Scope enforcement on bulk import consumer', () => {
        test('consumer validates write scope from event data before writing resources', async () => {
            // The consumer receives scope/user in the Kafka event but the current
            // code never checks them. It should verify the scope grants write
            // access before proceeding.
            // This test FAILS because the consumer does not check scopes at all.
            const resource = createResourceWithSecurityTags({
                resourceType: 'Patient',
                id: 'patient-scope-test',
                ownerCode: 'tenantA',
                accessCode: 'tenantA',
                sourceAssigningAuthority: 'tenantA'
            });

            async function* fakeReader() {
                yield { lineNumber: 1, resource };
            }
            mockS3NdjsonReader.readNdjsonAsync.mockReturnValue(fakeReader());

            // Scope does NOT include write access to tenantA - only read
            const message = createKafkaMessage({
                taskId: 'task-1',
                filepath: 's3://allowed-bucket/data.ndjson',
                scope: 'user/*.read access/tenantA.read',
                user: 'readonly-user'
            });

            await consumerRunner.handleMessageAsync(message);

            // With read-only scope, no resources should be written
            const totalWrites = mockInsertOneAsync.mock.calls.length +
                mockReplaceOneAsync.mock.calls.length;
            expect(totalWrites).toBe(0);

            // The task should be marked as failed due to insufficient scope
            expect(mockUpdateOneAsync).toHaveBeenCalled();
            const updateCalls = mockUpdateOneAsync.mock.calls;
            const lastUpdate = updateCalls[updateCalls.length - 1];
            const updatedDoc = lastUpdate?.[0]?.doc || lastUpdate?.[0];
            expect(updatedDoc?.status).toBe('failed');
        });

        test('consumer rejects import when scope has no access codes', async () => {
            // Without access/ scopes, the importer has no tenant identity and
            // must not be allowed to write.
            // This test FAILS because the consumer never validates scopes.
            const resource = createResourceWithSecurityTags({
                resourceType: 'Patient',
                id: 'patient-no-access',
                ownerCode: 'tenantA',
                accessCode: 'tenantA',
                sourceAssigningAuthority: 'tenantA'
            });

            async function* fakeReader() {
                yield { lineNumber: 1, resource };
            }
            mockS3NdjsonReader.readNdjsonAsync.mockReturnValue(fakeReader());

            const message = createKafkaMessage({
                taskId: 'task-1',
                filepath: 's3://allowed-bucket/data.ndjson',
                scope: 'user/*.*',
                user: 'no-access-user'
            });

            await consumerRunner.handleMessageAsync(message);

            // Without access codes, the consumer must fail the task
            const totalWrites = mockInsertOneAsync.mock.calls.length +
                mockReplaceOneAsync.mock.calls.length;
            expect(totalWrites).toBe(0);

            // Task should be marked as failed
            expect(mockUpdateOneAsync).toHaveBeenCalled();
            const updateCalls = mockUpdateOneAsync.mock.calls;
            const statusUpdates = updateCalls.filter(c => {
                const doc = c[0]?.doc || c[0];
                return doc?.status === 'failed';
            });
            expect(statusUpdates.length).toBeGreaterThan(0);
        });
    });

    describe('Cross-tenant reference validation', () => {
        test('resource with references to another tenant patient is rejected', async () => {
            // Attacker crafts an Observation that references a Patient belonging
            // to a different tenant - this could poison clinical data.
            // This test FAILS because no reference validation occurs.
            const crossTenantObservation = {
                resourceType: 'Observation',
                id: 'obs-xref-1',
                subject: { reference: 'Patient/tenantB-patient-123' },
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'tenantA' },
                        { system: SecurityTagSystem.access, code: 'tenantA' }
                    ],
                    source: 'tenantA'
                }
            };

            const validObservation = createResourceWithSecurityTags({
                resourceType: 'Observation',
                id: 'obs-valid-1',
                ownerCode: 'tenantA',
                accessCode: 'tenantA',
                sourceAssigningAuthority: 'tenantA'
            });
            validObservation.subject = { reference: 'Patient/tenantA-patient-456' };

            async function* fakeReader() {
                yield { lineNumber: 1, resource: crossTenantObservation };
                yield { lineNumber: 2, resource: validObservation };
            }
            mockS3NdjsonReader.readNdjsonAsync.mockReturnValue(fakeReader());

            // Mock reference lookup - the cross-tenant patient belongs to tenantB
            const queryManager = mockDatabaseQueryFactory.createQuery();
            queryManager.findOneAsync.mockImplementation(async ({ query }) => {
                if (query && query.id === 'task-1') {
                    return {
                        id: 'task-1',
                        status: 'in-progress',
                        meta: {
                            security: [
                                { system: SecurityTagSystem.owner, code: 'tenantA' },
                                { system: SecurityTagSystem.access, code: 'tenantA' }
                            ]
                        },
                        clone: function () {
                            return { ...this, meta: { ...this.meta, security: [...this.meta.security] } };
                        }
                    };
                }
                return null;
            });

            const message = createKafkaMessage({
                taskId: 'task-1',
                filepath: 's3://allowed-bucket/data.ndjson',
                scope: 'user/*.* access/tenantA.*',
                user: 'tenantA-admin'
            });

            await consumerRunner.handleMessageAsync(message);

            // The valid observation should be written but the cross-tenant one rejected
            const totalWrites = mockInsertOneAsync.mock.calls.length +
                mockReplaceOneAsync.mock.calls.length;
            expect(totalWrites).toBeGreaterThan(0);

            const allWrittenDocs = [
                ...mockInsertOneAsync.mock.calls.map(c => c[0]?.doc || c[0]),
                ...mockReplaceOneAsync.mock.calls.map(c => c[0]?.doc || c[0])
            ].filter(Boolean);

            // No written document should reference another tenant's patient
            const crossRefDocs = allWrittenDocs.filter(
                doc => doc?.subject?.reference === 'Patient/tenantB-patient-123'
            );
            expect(crossRefDocs).toHaveLength(0);
        });
    });

    describe('Trusted mode / system scope bypass prevention', () => {
        test('wildcard access scope does not bypass owner tag enforcement', async () => {
            // Even with wildcard access (*), imported resources must still have
            // their security tags validated against the Task's owner.
            // This test FAILS because no security tag enforcement exists.
            const resourceWithForeignOwner = createResourceWithSecurityTags({
                resourceType: 'Encounter',
                id: 'enc-wildcard-1',
                ownerCode: 'foreignTenant',
                accessCode: 'foreignTenant',
                sourceAssigningAuthority: 'foreignTenant'
            });

            async function* fakeReader() {
                yield { lineNumber: 1, resource: resourceWithForeignOwner };
            }
            mockS3NdjsonReader.readNdjsonAsync.mockReturnValue(fakeReader());

            const message = createKafkaMessage({
                taskId: 'task-1',
                filepath: 's3://allowed-bucket/data.ndjson',
                scope: 'user/*.* access/*.*',
                user: 'system-admin'
            });

            await consumerRunner.handleMessageAsync(message);

            // Even with wildcard scope, the resource owner tag must match the
            // Task's owner (tenantA). Wildcard scope grants broad access but
            // should not allow injecting resources into arbitrary tenants.
            const totalWrites = mockInsertOneAsync.mock.calls.length +
                mockReplaceOneAsync.mock.calls.length;
            expect(totalWrites).toBeGreaterThan(0);

            const allWrittenDocs = [
                ...mockInsertOneAsync.mock.calls.map(c => c[0]?.doc || c[0]),
                ...mockReplaceOneAsync.mock.calls.map(c => c[0]?.doc || c[0])
            ].filter(Boolean);

            for (const doc of allWrittenDocs) {
                const ownerTags = (doc.meta?.security || []).filter(
                    s => s.system === SecurityTagSystem.owner
                );
                if (ownerTags.length > 0) {
                    expect(ownerTags[0].code).toBe('tenantA');
                }
            }
        });
    });

    describe('Resource validation parity with normal create/update flow', () => {
        test('imported resources undergo meta validation equivalent to create flow', async () => {
            // The normal create/merge flow calls validateResourceMetaSync which
            // checks for invalid security tag values (null system, etc).
            // Bulk import must apply the same validation.
            // This test FAILS because the consumer skips all validation.
            const resourceWithNullSecurity = {
                resourceType: 'AllergyIntolerance',
                id: 'allergy-null-sec',
                meta: {
                    security: [
                        { system: 'null', code: 'tenantA' },
                        { system: SecurityTagSystem.owner, code: 'tenantA' }
                    ],
                    source: 'tenantA'
                }
            };

            const validResource = createResourceWithSecurityTags({
                resourceType: 'Patient',
                id: 'valid-patient-meta',
                ownerCode: 'tenantA',
                accessCode: 'tenantA',
                sourceAssigningAuthority: 'tenantA'
            });

            async function* fakeReader() {
                yield { lineNumber: 1, resource: resourceWithNullSecurity };
                yield { lineNumber: 2, resource: validResource };
            }
            mockS3NdjsonReader.readNdjsonAsync.mockReturnValue(fakeReader());

            const message = createKafkaMessage({
                taskId: 'task-1',
                filepath: 's3://allowed-bucket/data.ndjson',
                scope: 'user/*.* access/tenantA.*',
                user: 'tenantA-admin'
            });

            await consumerRunner.handleMessageAsync(message);

            // Valid resource must be written
            const totalWrites = mockInsertOneAsync.mock.calls.length +
                mockReplaceOneAsync.mock.calls.length;
            expect(totalWrites).toBeGreaterThan(0);

            // Invalid resource (with 'null' system) must NOT be written
            const allWrittenDocs = [
                ...mockInsertOneAsync.mock.calls.map(c => c[0]?.doc || c[0]),
                ...mockReplaceOneAsync.mock.calls.map(c => c[0]?.doc || c[0])
            ].filter(Boolean);

            const docsWithNullSystem = allWrittenDocs.filter(doc =>
                (doc.meta?.security || []).some(
                    s => s.system?.toLowerCase() === 'null' || s.system === ''
                )
            );
            expect(docsWithNullSystem).toHaveLength(0);
        });

        test('imported resources without owner tag are rejected or stamped', async () => {
            // validateResourceMetaSync requires owner tags - bulk import must too.
            // This test FAILS because the consumer does not validate resources.
            const resourceNoOwner = {
                resourceType: 'Procedure',
                id: 'proc-no-owner',
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'tenantA' }
                    ],
                    source: 'tenantA'
                }
            };

            async function* fakeReader() {
                yield { lineNumber: 1, resource: resourceNoOwner };
            }
            mockS3NdjsonReader.readNdjsonAsync.mockReturnValue(fakeReader());

            const message = createKafkaMessage({
                taskId: 'task-1',
                filepath: 's3://allowed-bucket/data.ndjson',
                scope: 'user/*.* access/tenantA.*',
                user: 'tenantA-admin'
            });

            await consumerRunner.handleMessageAsync(message);

            const totalWrites = mockInsertOneAsync.mock.calls.length +
                mockReplaceOneAsync.mock.calls.length;

            // Either the resource is rejected (0 writes) or stamped (1 write with owner)
            // In either case: no persisted doc should lack an owner tag for tenantA
            if (totalWrites > 0) {
                const allWrittenDocs = [
                    ...mockInsertOneAsync.mock.calls.map(c => c[0]?.doc || c[0]),
                    ...mockReplaceOneAsync.mock.calls.map(c => c[0]?.doc || c[0])
                ].filter(Boolean);

                for (const doc of allWrittenDocs) {
                    const ownerTags = (doc.meta?.security || []).filter(
                        s => s.system === SecurityTagSystem.owner
                    );
                    expect(ownerTags.length).toBeGreaterThanOrEqual(1);
                    expect(ownerTags[0].code).toBe('tenantA');
                }
            }
            // But the resource WAS yielded - system must process it (write or reject)
            expect(totalWrites).toBeGreaterThan(0);
        });
    });

    describe('Access tag manipulation prevention', () => {
        test('attacker cannot inject access tags for tenants they do not own', async () => {
            // The access tag determines who can READ the resource. An attacker
            // could grant read access to another tenant by injecting extra access tags.
            // This test FAILS because no access tag filtering occurs.
            const resourceWithExtraAccess = {
                resourceType: 'DiagnosticReport',
                id: 'diag-extra-access',
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'tenantA' },
                        { system: SecurityTagSystem.access, code: 'tenantA' },
                        { system: SecurityTagSystem.access, code: 'tenantC' }
                    ],
                    source: 'tenantA'
                }
            };

            async function* fakeReader() {
                yield { lineNumber: 1, resource: resourceWithExtraAccess };
            }
            mockS3NdjsonReader.readNdjsonAsync.mockReturnValue(fakeReader());

            const message = createKafkaMessage({
                taskId: 'task-1',
                filepath: 's3://allowed-bucket/data.ndjson',
                scope: 'user/*.* access/tenantA.*',
                user: 'tenantA-admin'
            });

            await consumerRunner.handleMessageAsync(message);

            const totalWrites = mockInsertOneAsync.mock.calls.length +
                mockReplaceOneAsync.mock.calls.length;
            expect(totalWrites).toBeGreaterThan(0);

            const allWrittenDocs = [
                ...mockInsertOneAsync.mock.calls.map(c => c[0]?.doc || c[0]),
                ...mockReplaceOneAsync.mock.calls.map(c => c[0]?.doc || c[0])
            ].filter(Boolean);

            // No access tag for tenants outside the importer's scope
            for (const doc of allWrittenDocs) {
                const accessTags = (doc.meta?.security || []).filter(
                    s => s.system === SecurityTagSystem.access
                );
                const unauthorizedAccess = accessTags.filter(
                    t => t.code !== 'tenantA'
                );
                expect(unauthorizedAccess).toHaveLength(0);
            }
        });

        test('sourceAssigningAuthority cannot be spoofed to another tenant', async () => {
            // sourceAssigningAuthority is used for UUID generation and data
            // lineage. Spoofing it could cause UUID collisions with another
            // tenant's data, effectively overwriting their resources.
            // This test FAILS because the consumer does not validate/rewrite SAA.
            const resourceWithSpoofedSAA = {
                resourceType: 'Patient',
                id: 'patient-spoofed-saa',
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'tenantA' },
                        { system: SecurityTagSystem.access, code: 'tenantA' },
                        { system: SecurityTagSystem.sourceAssigningAuthority, code: 'tenantB' }
                    ],
                    source: 'tenantA'
                }
            };

            async function* fakeReader() {
                yield { lineNumber: 1, resource: resourceWithSpoofedSAA };
            }
            mockS3NdjsonReader.readNdjsonAsync.mockReturnValue(fakeReader());

            const message = createKafkaMessage({
                taskId: 'task-1',
                filepath: 's3://allowed-bucket/data.ndjson',
                scope: 'user/*.* access/tenantA.*',
                user: 'tenantA-admin'
            });

            await consumerRunner.handleMessageAsync(message);

            const totalWrites = mockInsertOneAsync.mock.calls.length +
                mockReplaceOneAsync.mock.calls.length;
            expect(totalWrites).toBeGreaterThan(0);

            const allWrittenDocs = [
                ...mockInsertOneAsync.mock.calls.map(c => c[0]?.doc || c[0]),
                ...mockReplaceOneAsync.mock.calls.map(c => c[0]?.doc || c[0])
            ].filter(Boolean);

            // sourceAssigningAuthority must not be spoofable to another tenant
            for (const doc of allWrittenDocs) {
                const saaTags = (doc.meta?.security || []).filter(
                    s => s.system === SecurityTagSystem.sourceAssigningAuthority
                );
                for (const tag of saaTags) {
                    expect(tag.code).not.toBe('tenantB');
                }
            }
        });
    });
});
