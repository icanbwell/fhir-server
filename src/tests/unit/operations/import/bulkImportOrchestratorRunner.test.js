/**
 * Unit tests for BulkImportOrchestratorRunner.
 *
 * Covers:
 * - parseCloudEvent: validation of event type, taskId, and handling of untrusted fields
 * - headS3FilesAsync: S3 bucket allowlist enforcement, URI validation, file size checks
 * - handleMessageAsync: end-to-end message handling, logging of sensitive data
 *
 * Security-critical scenarios are documented inline.
 */
const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

// Mock logging before importing the module under test
jestGlobal.mock('../../../../operations/common/logging', () => {
    const { jest: j } = require('@jest/globals');
    return {
        logInfo: j.fn(),
        logError: j.fn(),
        logDebug: j.fn(),
        logWarn: j.fn()
    };
});

jestGlobal.mock('../../../../utils/assertType', () => ({
    assertTypeEquals: () => {},
    assertIsValid: () => {}
}));

// Mock the AWS SDK S3 client
const mockSend = jestGlobal.fn();
jestGlobal.mock('@aws-sdk/client-s3', () => ({
    S3Client: jestGlobal.fn().mockImplementation(() => ({ send: mockSend })),
    HeadObjectCommand: jestGlobal.fn().mockImplementation((params) => params)
}));

const { BulkImportOrchestratorRunner } = require('../../../../operations/import/bulkImportOrchestratorRunner');
const { logInfo, logError } = require('../../../../operations/common/logging');

/**
 * Creates a mock ConfigManager with standard bulk import settings.
 * @param {Object} overrides - Properties to override
 * @returns {Object} mock ConfigManager
 */
function createMockConfigManager(overrides = {}) {
    const config = {
        bulkImportAllowedS3Buckets: ['allowed-bucket', 'another-allowed-bucket'],
        awsRegion: 'us-east-1',
        bulkImportMinFileSizeMb: 0,
        bulkImportMaxFileSizeGb: 5,
        ...overrides
    };
    const obj = {};
    for (const [key, value] of Object.entries(config)) {
        Object.defineProperty(obj, key, { get: () => value, configurable: true });
    }
    return obj;
}

/**
 * Creates a BulkImportOrchestratorRunner with mock dependencies.
 * @param {Object} [configOverrides] - ConfigManager overrides
 * @returns {BulkImportOrchestratorRunner}
 */
function createRunner(configOverrides = {}) {
    return new BulkImportOrchestratorRunner({
        configManager: createMockConfigManager(configOverrides),
        kafkaClientV2: {},
        bulkImportEventProducer: {},
        databaseQueryFactory: { createQuery: jestGlobal.fn() },
        databaseUpdateFactory: { createDatabaseUpdateManager: jestGlobal.fn() }
    });
}

/**
 * Creates a valid TaskCreated CloudEvent message value (JSON string).
 */
function createTaskCreatedMessage({
    taskId = 'task-abc-123',
    inputs = [{ url: 's3://allowed-bucket/data/patients.ndjson' }],
    requestId = 'req-001',
    scope = 'system/*.read',
    user = 'practitioner/dr-smith'
} = {}) {
    return JSON.stringify({
        specversion: '1.0',
        id: 'evt-001',
        source: 'https://www.icanbwell.com/fhir-server',
        type: 'TaskCreated',
        datacontenttype: 'application/json',
        data: { taskId, inputs, requestId, scope, user }
    });
}

describe('BulkImportOrchestratorRunner', () => {
    let runner;

    beforeEach(() => {
        jestGlobal.clearAllMocks();
        mockSend.mockReset();
        runner = createRunner();
    });

    // =========================================================================
    // parseCloudEvent
    // =========================================================================
    describe('parseCloudEvent', () => {
        test('parses a valid TaskCreated event and returns data', () => {
            const messageValue = createTaskCreatedMessage({ taskId: 'task-xyz' });
            const result = runner.parseCloudEvent(messageValue);

            expect(result.taskId).toBe('task-xyz');
            expect(result.inputs).toBeDefined();
            expect(result.requestId).toBe('req-001');
        });

        test('throws on invalid JSON', () => {
            expect(() => runner.parseCloudEvent('not json')).toThrow();
        });

        test('rejects non-TaskCreated event types', () => {
            const msg = JSON.stringify({
                type: 'TaskCompleted',
                data: { taskId: 'task-1' }
            });

            expect(() => runner.parseCloudEvent(msg)).toThrow('Unexpected event type: TaskCompleted');
        });

        test('rejects event with missing type field', () => {
            const msg = JSON.stringify({ data: { taskId: 'task-1' } });

            expect(() => runner.parseCloudEvent(msg)).toThrow('Unexpected event type: undefined');
        });

        test('rejects event with missing data field', () => {
            const msg = JSON.stringify({ type: 'TaskCreated' });

            expect(() => runner.parseCloudEvent(msg)).toThrow('missing taskId');
        });

        test('rejects event with missing taskId in data', () => {
            const msg = JSON.stringify({
                type: 'TaskCreated',
                data: { inputs: [] }
            });

            expect(() => runner.parseCloudEvent(msg)).toThrow('missing taskId');
        });

        // SECURITY: parseCloudEvent does NOT validate scope or user fields.
        // An attacker who can publish to the Kafka topic can set arbitrary
        // scope/user and the orchestrator will process with those credentials.
        test('SECURITY: parseCloudEvent does not validate scope field - attacker can set arbitrary scope', () => {
            const maliciousMsg = createTaskCreatedMessage({
                scope: 'system/*.*',
                user: 'admin/root'
            });
            const result = runner.parseCloudEvent(maliciousMsg);

            // The parser blindly passes through whatever scope/user is provided
            expect(result.scope).toBe('system/*.*');
            expect(result.user).toBe('admin/root');
        });

        test('SECURITY: parseCloudEvent accepts empty string scope', () => {
            const msg = createTaskCreatedMessage({ scope: '' });
            const result = runner.parseCloudEvent(msg);

            // Empty scope is accepted without validation
            expect(result.scope).toBe('');
        });
    });

    // =========================================================================
    // headS3FilesAsync
    // =========================================================================
    describe('headS3FilesAsync', () => {
        beforeEach(() => {
            mockSend.mockResolvedValue({ ContentLength: 1024 * 1024 }); // 1 MB
        });

        test('returns file sizes for valid S3 URIs in allowed buckets', async () => {
            const inputs = [
                { url: 's3://allowed-bucket/path/to/file.ndjson' },
                { url: 's3://another-allowed-bucket/data.ndjson' }
            ];

            const results = await runner.headS3FilesAsync(inputs);

            expect(results).toHaveLength(2);
            expect(results[0]).toEqual({
                url: 's3://allowed-bucket/path/to/file.ndjson',
                fileSize: 1024 * 1024
            });
            expect(results[1]).toEqual({
                url: 's3://another-allowed-bucket/data.ndjson',
                fileSize: 1024 * 1024
            });
        });

        test('rejects S3 URIs from disallowed buckets', async () => {
            const inputs = [{ url: 's3://evil-bucket/stolen-data.ndjson' }];

            await expect(runner.headS3FilesAsync(inputs)).rejects.toThrow(
                'S3 bucket "evil-bucket" is not in the allowed list'
            );
        });

        test('rejects invalid S3 URIs - no protocol', async () => {
            const inputs = [{ url: 'https://allowed-bucket/file.ndjson' }];

            await expect(runner.headS3FilesAsync(inputs)).rejects.toThrow('Invalid S3 URI');
        });

        test('rejects S3 URI with bucket only and trailing slash (no key)', async () => {
            // The regex requires at least one character after bucket/
            const inputs = [{ url: 's3://allowed-bucket/' }];

            await expect(runner.headS3FilesAsync(inputs)).rejects.toThrow('Invalid S3 URI');
        });

        test('rejects S3 URI with bucket only and no trailing slash', async () => {
            const inputs = [{ url: 's3://allowed-bucket' }];

            await expect(runner.headS3FilesAsync(inputs)).rejects.toThrow('Invalid S3 URI');
        });

        test('accepts S3 URI with minimal single-character key', async () => {
            const inputs = [{ url: 's3://allowed-bucket/a' }];

            const results = await runner.headS3FilesAsync(inputs);

            expect(results).toHaveLength(1);
            expect(results[0].url).toBe('s3://allowed-bucket/a');
        });

        // SECURITY: Key path is not validated for traversal attempts
        test('SECURITY: does not validate key path for traversal patterns', async () => {
            const inputs = [{ url: 's3://allowed-bucket/../../other-tenant-bucket/data.ndjson' }];

            // The bucket is allowed, and the key is not validated for path traversal.
            // S3 treats keys as opaque strings, but this is a defense-in-depth gap.
            const results = await runner.headS3FilesAsync(inputs);

            expect(results).toHaveLength(1);
            expect(results[0].url).toBe('s3://allowed-bucket/../../other-tenant-bucket/data.ndjson');
        });

        test('SECURITY: does not validate key path with encoded traversal', async () => {
            const inputs = [{ url: 's3://allowed-bucket/%2e%2e%2f%2e%2e%2fsecret/data.ndjson' }];

            const results = await runner.headS3FilesAsync(inputs);

            expect(results).toHaveLength(1);
        });

        // BUG: If bulkImportAllowedS3Buckets is undefined/null, allowedBuckets.length
        // throws TypeError instead of a clear error message.
        test('BUG: throws TypeError when allowedBuckets is undefined', async () => {
            const undefinedBucketsRunner = createRunner({
                bulkImportAllowedS3Buckets: undefined
            });
            const inputs = [{ url: 's3://allowed-bucket/file.ndjson' }];

            // This will throw TypeError because you cannot read .length of undefined
            await expect(undefinedBucketsRunner.headS3FilesAsync(inputs)).rejects.toThrow(TypeError);
        });

        test('BUG: throws TypeError when allowedBuckets is null', async () => {
            const nullBucketsRunner = createRunner({
                bulkImportAllowedS3Buckets: null
            });
            const inputs = [{ url: 's3://allowed-bucket/file.ndjson' }];

            await expect(nullBucketsRunner.headS3FilesAsync(inputs)).rejects.toThrow(TypeError);
        });

        test('throws clear error when allowedBuckets is empty array', async () => {
            const emptyBucketsRunner = createRunner({
                bulkImportAllowedS3Buckets: []
            });
            const inputs = [{ url: 's3://allowed-bucket/file.ndjson' }];

            await expect(emptyBucketsRunner.headS3FilesAsync(inputs)).rejects.toThrow(
                'Bulk import S3 bucket allowlist is not configured'
            );
        });

        test('throws when S3 HEAD request fails (file not found)', async () => {
            mockSend.mockRejectedValue({ name: 'NotFound', message: 'Not Found' });
            const inputs = [{ url: 's3://allowed-bucket/missing-file.ndjson' }];

            await expect(runner.headS3FilesAsync(inputs)).rejects.toThrow(
                'Cannot access S3 file'
            );
        });

        test('throws when file is empty (0 bytes)', async () => {
            mockSend.mockResolvedValue({ ContentLength: 0 });
            const inputs = [{ url: 's3://allowed-bucket/empty.ndjson' }];

            await expect(runner.headS3FilesAsync(inputs)).rejects.toThrow('is empty (0 bytes)');
        });

        test('throws when file exceeds maximum size', async () => {
            // Set max to 5 GB, return a file larger than that
            const sixGb = 6 * 1024 * 1024 * 1024;
            mockSend.mockResolvedValue({ ContentLength: sixGb });
            const inputs = [{ url: 's3://allowed-bucket/huge-file.ndjson' }];

            await expect(runner.headS3FilesAsync(inputs)).rejects.toThrow(
                'above the maximum of 5 GB'
            );
        });

        test('throws when file is below minimum size', async () => {
            const minRunner = createRunner({ bulkImportMinFileSizeMb: 10 });
            // Return a file smaller than 10 MB
            mockSend.mockResolvedValue({ ContentLength: 1024 * 1024 }); // 1 MB
            const inputs = [{ url: 's3://allowed-bucket/tiny-file.ndjson' }];

            await expect(minRunner.headS3FilesAsync(inputs)).rejects.toThrow(
                'below the minimum of 10 MB'
            );
        });

        test('accepts file at exactly the maximum size boundary', async () => {
            const exactlyFiveGb = 5 * 1024 * 1024 * 1024;
            mockSend.mockResolvedValue({ ContentLength: exactlyFiveGb });
            const inputs = [{ url: 's3://allowed-bucket/big-file.ndjson' }];

            const results = await runner.headS3FilesAsync(inputs);

            expect(results[0].fileSize).toBe(exactlyFiveGb);
        });

        test('accepts file at exactly the minimum size boundary', async () => {
            const minRunner = createRunner({ bulkImportMinFileSizeMb: 10 });
            const exactlyTenMb = 10 * 1024 * 1024;
            mockSend.mockResolvedValue({ ContentLength: exactlyTenMb });
            const inputs = [{ url: 's3://allowed-bucket/exact-min.ndjson' }];

            const results = await minRunner.headS3FilesAsync(inputs);

            expect(results[0].fileSize).toBe(exactlyTenMb);
        });

        test('throws when ContentLength is undefined', async () => {
            mockSend.mockResolvedValue({}); // no ContentLength
            const inputs = [{ url: 's3://allowed-bucket/no-length.ndjson' }];

            await expect(runner.headS3FilesAsync(inputs)).rejects.toThrow(
                'returned no ContentLength'
            );
        });

        test('processes multiple files and fails on first disallowed bucket', async () => {
            const inputs = [
                { url: 's3://allowed-bucket/good.ndjson' },
                { url: 's3://evil-bucket/bad.ndjson' }
            ];

            await expect(runner.headS3FilesAsync(inputs)).rejects.toThrow(
                'S3 bucket "evil-bucket" is not in the allowed list'
            );
        });
    });

    // =========================================================================
    // handleMessageAsync
    // =========================================================================
    describe('handleMessageAsync', () => {
        test('parses valid message and logs event data', async () => {
            const message = {
                key: 'task-abc-123',
                value: createTaskCreatedMessage(),
                headers: []
            };

            await runner.handleMessageAsync(message);

            expect(logInfo).toHaveBeenCalledWith(
                'Orchestrator received TaskCreated event',
                expect.objectContaining({
                    taskId: 'task-abc-123',
                    inputCount: 1
                })
            );
        });

        test('logs error and returns on invalid message (no throw)', async () => {
            const message = {
                key: 'bad-key',
                value: 'not valid json',
                headers: []
            };

            // Should not throw - errors are caught and logged
            await runner.handleMessageAsync(message);

            expect(logError).toHaveBeenCalledWith(
                'Failed to parse TaskCreated Kafka message',
                expect.objectContaining({
                    key: 'bad-key'
                })
            );
        });

        test('logs error for non-TaskCreated event type without throwing', async () => {
            const message = {
                key: 'wrong-type',
                value: JSON.stringify({
                    type: 'TaskCompleted',
                    data: { taskId: 'task-1' }
                }),
                headers: []
            };

            await runner.handleMessageAsync(message);

            expect(logError).toHaveBeenCalledWith(
                'Failed to parse TaskCreated Kafka message',
                expect.objectContaining({
                    error: expect.stringContaining('Unexpected event type')
                })
            );
        });

        // SECURITY: handleMessageAsync logs the full inputs array (S3 URIs),
        // scope, and user to the application log. If inputs contain sensitive
        // path components (patient IDs, PHI in filenames), they are logged in cleartext.
        test('SECURITY: logs full inputs array including potentially sensitive S3 URIs', async () => {
            const sensitiveInputs = [
                { url: 's3://allowed-bucket/patient-123456789/ssn-data.ndjson' },
                { url: 's3://allowed-bucket/john-doe-DOB-1990-01-01/claims.ndjson' }
            ];
            const message = {
                key: 'task-sensitive',
                value: createTaskCreatedMessage({
                    taskId: 'task-sensitive',
                    inputs: sensitiveInputs,
                    scope: 'system/*.read',
                    user: 'patient/john-doe-mrn-987654'
                }),
                headers: []
            };

            await runner.handleMessageAsync(message);

            // The logInfo call includes the full inputs array with sensitive paths
            expect(logInfo).toHaveBeenCalledWith(
                'Orchestrator received TaskCreated event',
                expect.objectContaining({
                    inputs: sensitiveInputs,
                    scope: 'system/*.read',
                    user: 'patient/john-doe-mrn-987654'
                })
            );
        });

        test('SECURITY: logs user credential/identity from untrusted Kafka message', async () => {
            const message = {
                key: 'task-injected',
                value: createTaskCreatedMessage({
                    taskId: 'task-injected',
                    scope: 'system/*.*',
                    user: 'admin/superuser'
                }),
                headers: []
            };

            await runner.handleMessageAsync(message);

            // Attacker-controlled scope and user are logged and would be used
            expect(logInfo).toHaveBeenCalledWith(
                'Orchestrator received TaskCreated event',
                expect.objectContaining({
                    scope: 'system/*.*',
                    user: 'admin/superuser'
                })
            );
        });
    });
});
