/**
 * Unit tests for BulkImportHandler.
 *
 * Covers:
 * - parseTaskCreatedEvent: validation of event type, taskId, and handling of untrusted fields
 * - headS3FilesAsync: S3 bucket allowlist enforcement, URI validation, file size checks
 * - handleMessageAsync: end-to-end message handling, logging of sensitive data
 * - handleRangeProgressEventAsync (ImportRangeStarted/ImportRangeCompleted/ImportRangeFailed):
 *   the orchestrator's role as the sole writer of a Task's status/output once it exists
 * - countCompletedRanges: recognizing which ranges have already reported completion
 *
 * Security-critical scenarios are documented inline.
 */
const crypto = require('crypto');
const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

const TEST_WORKER_SECRET = 'test-worker-secret';

// Mirrors BulkImportEventProducer.signRangeProgressPayload -- createRangeProgressMessage
// below builds messages by hand rather than via the real producer, so it needs to sign the
// payload itself the same way.
const signRangeProgressPayload = (data) =>
    crypto.createHmac('sha256', TEST_WORKER_SECRET).update(JSON.stringify(data)).digest('hex');

// Mock logging before importing the module under test
jestGlobal.mock('../../../../../operations/common/logging', () => {
    const { jest: j } = require('@jest/globals');
    return {
        logInfo: j.fn(),
        logError: j.fn(),
        logDebug: j.fn(),
        logWarn: j.fn()
    };
});

jestGlobal.mock('../../../../../utils/assertType', () => ({
    assertTypeEquals: () => {},
    assertIsValid: () => {}
}));

// Mock the AWS SDK S3 client
const mockSend = jestGlobal.fn();
jestGlobal.mock('@aws-sdk/client-s3', () => ({
    S3Client: jestGlobal.fn().mockImplementation(() => ({ send: mockSend })),
    HeadObjectCommand: jestGlobal.fn().mockImplementation((params) => params)
}));

const { BulkImportHandler } = require('../../../../../operations/asyncJobs/bulkImport/handler');
const { logInfo, logError } = require('../../../../../operations/common/logging');
const metrics = require('../../../../../utils/metrics');
const { trace } = require('@opentelemetry/api');
// Spied once (module-scope singleton instrument) -- the outer beforeEach's
// clearAllMocks() resets call history between tests without re-wrapping.
jestGlobal.spyOn(metrics.importOperationsTriggeredCounter, 'add');
jestGlobal.spyOn(metrics.importFileSizeHistogram, 'record');

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
        // handleRangeProgressEventAsync's parseRangeProgressEvent refuses to trust a
        // range-progress message without this configured (see
        // BulkImportHandler.verifyRangeProgressSignature) -- createRangeProgressMessage below
        // signs with this exact value so the two stay in sync.
        bulkImportWorkerSecret: TEST_WORKER_SECRET,
        ...overrides
    };
    const obj = {};
    for (const [key, value] of Object.entries(config)) {
        Object.defineProperty(obj, key, { get: () => value, configurable: true });
    }
    return obj;
}

/**
 * Creates a mock Task resource with a working clone() (needed by
 * updateOrchestratorTaskStatusAsync). clone() returns another mock Task (itself
 * re-cloneable) rather than a plain object -- handleRangeCompletedAsync clones once to
 * append output, then may pass that clone into updateOrchestratorTaskStatusAsync, which
 * clones again to flip status; a plain `{...task}` spread would lose `.clone` on the second
 * hop and throw.
 * @param {Object} [overrides]
 */
function createMockTask(overrides = {}) {
    const task = {
        resourceType: 'Task',
        id: 'task-abc-123',
        status: 'requested',
        code: { coding: [{ system: 'https://www.icanbwell.com/task-type', code: 'bulk-import' }] },
        meta: { lastUpdated: '2026-01-01T00:00:00.000Z' },
        ...overrides
    };
    task.clone = jestGlobal.fn(() => createMockTask({ ...task, clone: undefined }));
    return task;
}

/**
 * Creates a BulkImportHandler with mock dependencies. Defaults simulate the happy path
 * (Task found, S3 HEAD succeeds via the outer beforeEach's mockSend, events published) so
 * individual tests only need to override what's actually relevant to them.
 * @param {Object} [configOverrides] - ConfigManager overrides
 * @param {Object} [depsOverrides] - Constructor dependency overrides (e.g. databaseQueryFactory)
 * @returns {BulkImportHandler}
 */
function createHandler(configOverrides = {}, depsOverrides = {}) {
    return new BulkImportHandler({
        configManager: createMockConfigManager(configOverrides),
        kafkaClientV2: {},
        bulkImportEventProducer: {
            publishImportEventsAsync: jestGlobal.fn().mockResolvedValue(1)
        },
        databaseQueryFactory: {
            createQuery: jestGlobal.fn(() => ({
                findOneAsync: jestGlobal.fn().mockResolvedValue(createMockTask())
            }))
        },
        databaseUpdateFactory: {
            createDatabaseUpdateManager: jestGlobal.fn(() => ({
                updateOneAsync: jestGlobal.fn().mockResolvedValue(undefined)
            }))
        },
        fastDatabaseBulkInserter: {},
        s3NdjsonReader: {},
        postRequestProcessor: {},
        requestSpecificCache: {},
        ...depsOverrides
    });
}

/**
 * Creates a valid ImportRangeStarted/ImportRangeCompleted/ImportRangeFailed CloudEvent
 * message value (JSON string).
 */
function createRangeProgressMessage(type, {
    taskId = 'task-abc-123',
    filepath = 's3://allowed-bucket/data/patients.ndjson',
    rangeIndex = 0,
    taskTotalRanges = 1,
    resultUri,
    errorUri,
    errorMessage
} = {}) {
    const data = { taskId, filepath, rangeIndex, taskTotalRanges };
    if (resultUri !== undefined) {
        data.resultUri = resultUri;
    }
    if (errorUri !== undefined) {
        data.errorUri = errorUri;
    }
    if (errorMessage !== undefined) {
        data.errorMessage = errorMessage;
    }
    data.signature = signRangeProgressPayload(data);

    return JSON.stringify({
        specversion: '1.0',
        id: 'evt-range-001',
        source: 'https://www.icanbwell.com/fhir-server',
        type,
        datacontenttype: 'application/json',
        data
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
    user = 'practitioner/dr-smith',
    alternateUserId = 'alt-dr-smith',
    isUser = true,
    remoteIpAddress = '10.0.0.1'
} = {}) {
    return JSON.stringify({
        specversion: '1.0',
        id: 'evt-001',
        source: 'https://www.icanbwell.com/fhir-server',
        type: 'TaskCreated',
        datacontenttype: 'application/json',
        data: { taskId, inputs, requestId, scope, user, alternateUserId, isUser, remoteIpAddress }
    });
}

describe('BulkImportHandler - TaskCreated (orchestrator)', () => {
    let handler;

    beforeEach(() => {
        jestGlobal.clearAllMocks();
        mockSend.mockReset();
        // Default happy-path S3 HEAD response (10 MB) -- the headS3FilesAsync describe
        // block below overrides this per-test via its own nested beforeEach/tests.
        mockSend.mockResolvedValue({ ContentLength: 10 * 1024 * 1024 });
        handler = createHandler();
    });

    // =========================================================================
    // parseTaskCreatedEvent
    // =========================================================================
    describe('parseTaskCreatedEvent', () => {
        test('parses a valid TaskCreated event and returns data', () => {
            const messageValue = createTaskCreatedMessage({ taskId: 'task-xyz' });
            const result = handler.parseTaskCreatedEvent(messageValue);

            expect(result.taskId).toBe('task-xyz');
            expect(result.inputs).toBeDefined();
            expect(result.requestId).toBe('req-001');
        });

        test('throws on invalid JSON', () => {
            expect(() => handler.parseTaskCreatedEvent('not json')).toThrow();
        });

        test('rejects non-TaskCreated event types', () => {
            const msg = JSON.stringify({
                type: 'TaskCompleted',
                data: { taskId: 'task-1' }
            });

            expect(() => handler.parseTaskCreatedEvent(msg)).toThrow('Unexpected event type: TaskCompleted');
        });

        test('rejects event with missing type field', () => {
            const msg = JSON.stringify({ data: { taskId: 'task-1' } });

            expect(() => handler.parseTaskCreatedEvent(msg)).toThrow('Unexpected event type: undefined');
        });

        test('rejects event with missing data field', () => {
            const msg = JSON.stringify({ type: 'TaskCreated' });

            expect(() => handler.parseTaskCreatedEvent(msg)).toThrow('missing taskId');
        });

        test('rejects event with missing taskId in data', () => {
            const msg = JSON.stringify({
                type: 'TaskCreated',
                data: { inputs: [] }
            });

            expect(() => handler.parseTaskCreatedEvent(msg)).toThrow('missing taskId');
        });

        // SECURITY: parseTaskCreatedEvent does NOT validate scope or user fields.
        // An attacker who can publish to the Kafka topic can set arbitrary
        // scope/user and the orchestrator will process with those credentials.
        test('SECURITY: parseTaskCreatedEvent does not validate scope field - attacker can set arbitrary scope', () => {
            const maliciousMsg = createTaskCreatedMessage({
                scope: 'system/*.*',
                user: 'admin/root'
            });
            const result = handler.parseTaskCreatedEvent(maliciousMsg);

            // The parser blindly passes through whatever scope/user is provided
            expect(result.scope).toBe('system/*.*');
            expect(result.user).toBe('admin/root');
        });

        test('SECURITY: parseTaskCreatedEvent accepts empty string scope', () => {
            const msg = createTaskCreatedMessage({ scope: '' });
            const result = handler.parseTaskCreatedEvent(msg);

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

            const results = await handler.headS3FilesAsync(inputs);

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

        test('BAI-229: records fhir_import_file_size_bytes once per successfully HEAD-ed file', async () => {
            const inputs = [
                { url: 's3://allowed-bucket/path/to/file.ndjson' },
                { url: 's3://another-allowed-bucket/data.ndjson' }
            ];

            await handler.headS3FilesAsync(inputs);

            expect(metrics.importFileSizeHistogram.record).toHaveBeenCalledTimes(2);
            expect(metrics.importFileSizeHistogram.record).toHaveBeenCalledWith(1024 * 1024);
        });

        test('BAI-229: does not record file size for a rejected (disallowed-bucket) file', async () => {
            const inputs = [{ url: 's3://evil-bucket/stolen-data.ndjson' }];

            await expect(handler.headS3FilesAsync(inputs)).rejects.toThrow();

            expect(metrics.importFileSizeHistogram.record).not.toHaveBeenCalled();
        });

        test('rejects S3 URIs from disallowed buckets', async () => {
            const inputs = [{ url: 's3://evil-bucket/stolen-data.ndjson' }];

            await expect(handler.headS3FilesAsync(inputs)).rejects.toThrow(
                'S3 bucket "evil-bucket" is not in the allowed list'
            );
        });

        test('rejects invalid S3 URIs - no protocol', async () => {
            const inputs = [{ url: 'https://allowed-bucket/file.ndjson' }];

            await expect(handler.headS3FilesAsync(inputs)).rejects.toThrow('Invalid S3 URI');
        });

        test('rejects S3 URI with bucket only and trailing slash (no key)', async () => {
            // The regex requires at least one character after bucket/
            const inputs = [{ url: 's3://allowed-bucket/' }];

            await expect(handler.headS3FilesAsync(inputs)).rejects.toThrow('Invalid S3 URI');
        });

        test('rejects S3 URI with bucket only and no trailing slash', async () => {
            const inputs = [{ url: 's3://allowed-bucket' }];

            await expect(handler.headS3FilesAsync(inputs)).rejects.toThrow('Invalid S3 URI');
        });

        test('accepts S3 URI with minimal single-character key', async () => {
            const inputs = [{ url: 's3://allowed-bucket/a' }];

            const results = await handler.headS3FilesAsync(inputs);

            expect(results).toHaveLength(1);
            expect(results[0].url).toBe('s3://allowed-bucket/a');
        });

        // SECURITY: Key path is not validated for traversal attempts
        test('SECURITY: does not validate key path for traversal patterns', async () => {
            const inputs = [{ url: 's3://allowed-bucket/../../other-tenant-bucket/data.ndjson' }];

            // The bucket is allowed, and the key is not validated for path traversal.
            // S3 treats keys as opaque strings, but this is a defense-in-depth gap.
            const results = await handler.headS3FilesAsync(inputs);

            expect(results).toHaveLength(1);
            expect(results[0].url).toBe('s3://allowed-bucket/../../other-tenant-bucket/data.ndjson');
        });

        test('SECURITY: does not validate key path with encoded traversal', async () => {
            const inputs = [{ url: 's3://allowed-bucket/%2e%2e%2f%2e%2e%2fsecret/data.ndjson' }];

            const results = await handler.headS3FilesAsync(inputs);

            expect(results).toHaveLength(1);
        });

        // BUG: If bulkImportAllowedS3Buckets is undefined/null, allowedBuckets.length
        // throws TypeError instead of a clear error message.
        test('BUG: throws TypeError when allowedBuckets is undefined', async () => {
            const undefinedBucketsHandler = createHandler({
                bulkImportAllowedS3Buckets: undefined
            });
            const inputs = [{ url: 's3://allowed-bucket/file.ndjson' }];

            // This will throw TypeError because you cannot read .length of undefined
            await expect(undefinedBucketsHandler.headS3FilesAsync(inputs)).rejects.toThrow(TypeError);
        });

        test('BUG: throws TypeError when allowedBuckets is null', async () => {
            const nullBucketsHandler = createHandler({
                bulkImportAllowedS3Buckets: null
            });
            const inputs = [{ url: 's3://allowed-bucket/file.ndjson' }];

            await expect(nullBucketsHandler.headS3FilesAsync(inputs)).rejects.toThrow(TypeError);
        });

        test('throws clear error when allowedBuckets is empty array', async () => {
            const emptyBucketsHandler = createHandler({
                bulkImportAllowedS3Buckets: []
            });
            const inputs = [{ url: 's3://allowed-bucket/file.ndjson' }];

            await expect(emptyBucketsHandler.headS3FilesAsync(inputs)).rejects.toThrow(
                'Bulk import S3 bucket allowlist is not configured'
            );
        });

        test('throws when S3 HEAD request fails (file not found)', async () => {
            mockSend.mockRejectedValue({ name: 'NotFound', message: 'Not Found' });
            const inputs = [{ url: 's3://allowed-bucket/missing-file.ndjson' }];

            await expect(handler.headS3FilesAsync(inputs)).rejects.toThrow(
                'Cannot access S3 file'
            );
        });

        test('throws when file is empty (0 bytes)', async () => {
            mockSend.mockResolvedValue({ ContentLength: 0 });
            const inputs = [{ url: 's3://allowed-bucket/empty.ndjson' }];

            await expect(handler.headS3FilesAsync(inputs)).rejects.toThrow('is empty (0 bytes)');
        });

        test('throws when file exceeds maximum size', async () => {
            // Set max to 5 GB, return a file larger than that
            const sixGb = 6 * 1024 * 1024 * 1024;
            mockSend.mockResolvedValue({ ContentLength: sixGb });
            const inputs = [{ url: 's3://allowed-bucket/huge-file.ndjson' }];

            await expect(handler.headS3FilesAsync(inputs)).rejects.toThrow(
                'above the maximum of 5 GB'
            );
        });

        test('throws when file is below minimum size', async () => {
            const minHandler = createHandler({ bulkImportMinFileSizeMb: 10 });
            // Return a file smaller than 10 MB
            mockSend.mockResolvedValue({ ContentLength: 1024 * 1024 }); // 1 MB
            const inputs = [{ url: 's3://allowed-bucket/tiny-file.ndjson' }];

            await expect(minHandler.headS3FilesAsync(inputs)).rejects.toThrow(
                'below the minimum of 10 MB'
            );
        });

        test('accepts file at exactly the maximum size boundary', async () => {
            const exactlyFiveGb = 5 * 1024 * 1024 * 1024;
            mockSend.mockResolvedValue({ ContentLength: exactlyFiveGb });
            const inputs = [{ url: 's3://allowed-bucket/big-file.ndjson' }];

            const results = await handler.headS3FilesAsync(inputs);

            expect(results[0].fileSize).toBe(exactlyFiveGb);
        });

        test('accepts file at exactly the minimum size boundary', async () => {
            const minHandler = createHandler({ bulkImportMinFileSizeMb: 10 });
            const exactlyTenMb = 10 * 1024 * 1024;
            mockSend.mockResolvedValue({ ContentLength: exactlyTenMb });
            const inputs = [{ url: 's3://allowed-bucket/exact-min.ndjson' }];

            const results = await minHandler.headS3FilesAsync(inputs);

            expect(results[0].fileSize).toBe(exactlyTenMb);
        });

        test('throws when ContentLength is undefined', async () => {
            mockSend.mockResolvedValue({}); // no ContentLength
            const inputs = [{ url: 's3://allowed-bucket/no-length.ndjson' }];

            await expect(handler.headS3FilesAsync(inputs)).rejects.toThrow(
                'returned no ContentLength'
            );
        });

        test('processes multiple files and fails on first disallowed bucket', async () => {
            const inputs = [
                { url: 's3://allowed-bucket/good.ndjson' },
                { url: 's3://evil-bucket/bad.ndjson' }
            ];

            await expect(handler.headS3FilesAsync(inputs)).rejects.toThrow(
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

            await handler.handleMessageAsync(message);

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

            // Should not throw - errors are caught and logged. Malformed JSON is
            // caught by handleMessageAsync's own top-level parse, before routing by
            // type, so it never reaches the TaskCreated-specific parse/log below.
            await handler.handleMessageAsync(message);

            expect(logError).toHaveBeenCalledWith(
                'Failed to parse bulk import Kafka message',
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

            await handler.handleMessageAsync(message);

            // handleMessageAsync's own type-based routing rejects this before it ever
            // reaches handleTaskCreatedAsync's internal parseTaskCreatedEvent check.
            expect(logError).toHaveBeenCalledWith(
                'Unexpected bulk import event type',
                expect.objectContaining({
                    type: 'TaskCompleted',
                    key: 'wrong-type'
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

            await handler.handleMessageAsync(message);

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

            await handler.handleMessageAsync(message);

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

    // =========================================================================
    // handleTaskCreatedAsync: byte-range splitting and publishing
    // =========================================================================
    describe('handleTaskCreatedAsync range publishing', () => {
        test('HEADs S3 inputs, publishes range messages, and logs the count', async () => {
            const publishImportEventsAsync = jestGlobal.fn().mockResolvedValue(3);
            handler = createHandler({}, {
                bulkImportEventProducer: { publishImportEventsAsync }
            });

            const message = {
                key: 'task-abc-123',
                value: createTaskCreatedMessage({
                    taskId: 'task-abc-123',
                    inputs: [{ url: 's3://allowed-bucket/data/patients.ndjson' }],
                    requestId: 'req-001',
                    scope: 'system/*.read',
                    user: 'practitioner/dr-smith'
                }),
                headers: []
            };

            await handler.handleMessageAsync(message);

            // alternateUserId/isUser/remoteIpAddress must be forwarded to the event producer
            // unchanged -- these are what ultimately populate AuditEvent.agent[0].altId/who/
            // network.address for every resource this Task's ranges write (see BAI-432).
            expect(publishImportEventsAsync).toHaveBeenCalledWith({
                taskId: 'task-abc-123',
                inputs: [{ url: 's3://allowed-bucket/data/patients.ndjson', fileSize: 10 * 1024 * 1024 }],
                requestId: 'req-001',
                scope: 'system/*.read',
                user: 'practitioner/dr-smith',
                alternateUserId: 'alt-dr-smith',
                isUser: true,
                remoteIpAddress: '10.0.0.1'
            });
            expect(logInfo).toHaveBeenCalledWith(
                'Orchestrator published byte-range messages',
                expect.objectContaining({ taskId: 'task-abc-123', messageCount: 3 })
            );
            expect(metrics.importOperationsTriggeredCounter.add).toHaveBeenCalledTimes(1);
            expect(metrics.importOperationsTriggeredCounter.add).toHaveBeenCalledWith(1);
        });

        test('BAI-229: still records operations_triggered when S3 validation later fails', async () => {
            mockSend.mockRejectedValue(Object.assign(new Error('NotFound'), { name: 'NotFound' }));
            handler = createHandler({}, {
                databaseUpdateFactory: {
                    createDatabaseUpdateManager: jestGlobal.fn(() => ({
                        updateOneAsync: jestGlobal.fn().mockResolvedValue(undefined)
                    }))
                }
            });

            const message = {
                key: 'task-bad-s3',
                value: createTaskCreatedMessage({ taskId: 'task-bad-s3' }),
                headers: []
            };

            // Fake an active span so recordImportSpanAttributes' fallback (starting its own
            // span) isn't what's under test here -- just that the right attributes reach *a* span.
            const fakeSpan = { setAttributes: jestGlobal.fn() };
            const activeSpanSpy = jestGlobal.spyOn(trace, 'getActiveSpan').mockReturnValue(fakeSpan);

            await handler.handleMessageAsync(message);

            // The operation was triggered (Task found) even though S3 validation failed
            // afterward -- "triggered" tracks activity, not eventual success.
            expect(metrics.importOperationsTriggeredCounter.add).toHaveBeenCalledTimes(1);

            // An S3-validation failure is a whole-Task failure, not a partial one -- tagged
            // as a span attribute so alerts can be built on it, grouped by trace ID.
            expect(fakeSpan.setAttributes).toHaveBeenCalledWith({ 'fhir_import.outcome': 'failed' });
            activeSpanSpy.mockRestore();
        });

        test('logs and returns without publishing when the Task cannot be found', async () => {
            const publishImportEventsAsync = jestGlobal.fn().mockResolvedValue(1);
            handler = createHandler({}, {
                bulkImportEventProducer: { publishImportEventsAsync },
                databaseQueryFactory: {
                    createQuery: jestGlobal.fn(() => ({
                        findOneAsync: jestGlobal.fn().mockResolvedValue(null)
                    }))
                }
            });

            const message = {
                key: 'task-missing',
                value: createTaskCreatedMessage({ taskId: 'task-missing' }),
                headers: []
            };

            await handler.handleMessageAsync(message);

            expect(logError).toHaveBeenCalledWith(
                'Task not found for orchestrator message',
                { taskId: 'task-missing' }
            );
            expect(publishImportEventsAsync).not.toHaveBeenCalled();
            expect(metrics.importOperationsTriggeredCounter.add).not.toHaveBeenCalled();
        });

        test('marks the Task failed and does not publish when S3 validation fails', async () => {
            mockSend.mockRejectedValue(Object.assign(new Error('NotFound'), { name: 'NotFound' }));
            const publishImportEventsAsync = jestGlobal.fn().mockResolvedValue(1);
            const updateOneAsync = jestGlobal.fn().mockResolvedValue(undefined);
            handler = createHandler({}, {
                bulkImportEventProducer: { publishImportEventsAsync },
                databaseUpdateFactory: {
                    createDatabaseUpdateManager: jestGlobal.fn(() => ({ updateOneAsync }))
                }
            });

            const message = {
                key: 'task-bad-s3',
                value: createTaskCreatedMessage({ taskId: 'task-bad-s3' }),
                headers: []
            };

            await handler.handleMessageAsync(message);

            expect(logError).toHaveBeenCalledWith(
                'S3 validation failed for import task',
                expect.objectContaining({ taskId: 'task-bad-s3' })
            );
            expect(publishImportEventsAsync).not.toHaveBeenCalled();
            expect(updateOneAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    doc: expect.objectContaining({ status: 'failed' })
                })
            );
        });
    });

    // =========================================================================
    // handleRangeProgressEventAsync: ImportRangeStarted/ImportRangeCompleted/ImportRangeFailed
    //
    // The worker never touches the Task resource -- these are the ONLY writes to a Task
    // once it exists. Each test below captures the `doc` passed to updateOneAsync to verify
    // exactly what the orchestrator wrote.
    // =========================================================================
    describe('handleRangeProgressEventAsync', () => {
        /**
         * @param {Object} [taskOverrides]
         * @returns {{ handler: BulkImportHandler, updateOneAsync: Function, findOneAsync: Function }}
         */
        function createHandlerCapturingTaskWrites(taskOverrides = {}) {
            const updateOneAsync = jestGlobal.fn().mockResolvedValue(undefined);
            const findOneAsync = jestGlobal.fn().mockResolvedValue(createMockTask(taskOverrides));
            const handlerInstance = createHandler({}, {
                databaseQueryFactory: {
                    createQuery: jestGlobal.fn(() => ({ findOneAsync }))
                },
                databaseUpdateFactory: {
                    createDatabaseUpdateManager: jestGlobal.fn(() => ({ updateOneAsync }))
                }
            });
            return { handler: handlerInstance, updateOneAsync, findOneAsync };
        }

        // IDOR: without signature verification, anyone able to publish onto
        // kafkaBulkImportRangeProgressTopic could forge a message with an arbitrary taskId and
        // manipulate any Task's status/output -- these are the only authentication this topic
        // has, so parseRangeProgressEvent must reject rather than trust an invalid message.
        describe('signature verification', () => {
            test('rejects a message with no signature at all', async () => {
                const { handler: h, updateOneAsync } = createHandlerCapturingTaskWrites({ status: 'requested' });
                const data = { taskId: 'task-abc-123', filepath: 's3://allowed-bucket/data/patients.ndjson', rangeIndex: 0, taskTotalRanges: 1 };

                await h.handleMessageAsync({
                    key: 'k1',
                    value: JSON.stringify({
                        specversion: '1.0', id: 'evt-1', source: 'https://www.icanbwell.com/fhir-server',
                        type: 'ImportRangeStarted', datacontenttype: 'application/json', data
                    }),
                    headers: []
                });

                expect(logError).toHaveBeenCalledWith(
                    'Failed to parse bulk import range-progress Kafka message',
                    expect.objectContaining({ error: expect.stringContaining('missing its signature') })
                );
                expect(updateOneAsync).not.toHaveBeenCalled();
            });

            test('rejects a message whose signature does not match its payload', async () => {
                const { handler: h, updateOneAsync } = createHandlerCapturingTaskWrites({ status: 'requested' });
                const data = {
                    taskId: 'task-abc-123', filepath: 's3://allowed-bucket/data/patients.ndjson', rangeIndex: 0,
                    taskTotalRanges: 1, signature: signRangeProgressPayload({ taskId: 'a-different-task' })
                };

                await h.handleMessageAsync({
                    key: 'k1',
                    value: JSON.stringify({
                        specversion: '1.0', id: 'evt-1', source: 'https://www.icanbwell.com/fhir-server',
                        type: 'ImportRangeStarted', datacontenttype: 'application/json', data
                    }),
                    headers: []
                });

                expect(logError).toHaveBeenCalledWith(
                    'Failed to parse bulk import range-progress Kafka message',
                    expect.objectContaining({ error: expect.stringContaining('signature does not match') })
                );
                expect(updateOneAsync).not.toHaveBeenCalled();
            });

            test('does not mutate a Task that lacks the bulk-import code, even with a valid signature', async () => {
                // A valid HMAC proves the message came from a trusted worker but does not grant
                // permission to modify an arbitrary Task -- loadTaskAsync now restricts its query
                // to Tasks carrying the bulk-import code so a message with a legitimate signature
                // but a taskId pointing at a non-import Task is silently dropped.
                const updateOneAsync = jestGlobal.fn().mockResolvedValue(undefined);
                const handlerInstance = createHandler({}, {
                    databaseQueryFactory: {
                        createQuery: jestGlobal.fn(() => ({
                            findOneAsync: jestGlobal.fn().mockResolvedValue(null) // code filter returns nothing
                        }))
                    },
                    databaseUpdateFactory: {
                        createDatabaseUpdateManager: jestGlobal.fn(() => ({ updateOneAsync }))
                    }
                });

                await handlerInstance.handleMessageAsync({
                    key: 'k1',
                    value: createRangeProgressMessage('ImportRangeStarted'),
                    headers: []
                });

                expect(updateOneAsync).not.toHaveBeenCalled();
            });

            // S3 URI allowlist -- filepath, resultUri, and errorUri are written into
            // Task.output as-is, so a compromised worker (or a replayed message that passed
            // HMAC verification) must not be able to inject arbitrary URIs into Task output.
            test('rejects a message whose filepath is not in the S3 allowlist', async () => {
                const { handler: h, updateOneAsync } = createHandlerCapturingTaskWrites({ status: 'requested' });
                const data = { taskId: 'task-abc-123', filepath: 's3://disallowed-bucket/data/patients.ndjson', rangeIndex: 0, taskTotalRanges: 1 };
                data.signature = signRangeProgressPayload(data);

                await h.handleMessageAsync({
                    key: 'k1',
                    value: JSON.stringify({
                        specversion: '1.0', id: 'evt-1', source: 'https://www.icanbwell.com/fhir-server',
                        type: 'ImportRangeStarted', datacontenttype: 'application/json', data
                    }),
                    headers: []
                });

                expect(logError).toHaveBeenCalledWith(
                    'Failed to parse bulk import range-progress Kafka message',
                    expect.objectContaining({ error: expect.stringContaining('disallowed S3 bucket') })
                );
                expect(updateOneAsync).not.toHaveBeenCalled();
            });

            test('rejects a message whose resultUri is not in the S3 allowlist', async () => {
                const { handler: h, updateOneAsync } = createHandlerCapturingTaskWrites({ status: 'in-progress' });
                const data = {
                    taskId: 'task-abc-123', filepath: 's3://allowed-bucket/data/patients.ndjson',
                    rangeIndex: 0, taskTotalRanges: 1,
                    resultUri: 's3://evil-bucket/result.ndjson', errorUri: null
                };
                data.signature = signRangeProgressPayload(data);

                await h.handleMessageAsync({
                    key: 'k1',
                    value: JSON.stringify({
                        specversion: '1.0', id: 'evt-1', source: 'https://www.icanbwell.com/fhir-server',
                        type: 'ImportRangeCompleted', datacontenttype: 'application/json', data
                    }),
                    headers: []
                });

                expect(logError).toHaveBeenCalledWith(
                    'Failed to parse bulk import range-progress Kafka message',
                    expect.objectContaining({ error: expect.stringContaining('disallowed S3 bucket') })
                );
                expect(updateOneAsync).not.toHaveBeenCalled();
            });

            test('rejects every range-progress message when the worker secret is not configured', async () => {
                const updateOneAsync = jestGlobal.fn().mockResolvedValue(undefined);
                const handlerInstance = createHandler({ bulkImportWorkerSecret: undefined }, {
                    databaseQueryFactory: {
                        createQuery: jestGlobal.fn(() => ({ findOneAsync: jestGlobal.fn().mockResolvedValue(createMockTask()) }))
                    },
                    databaseUpdateFactory: {
                        createDatabaseUpdateManager: jestGlobal.fn(() => ({ updateOneAsync }))
                    }
                });

                await handlerInstance.handleMessageAsync({
                    key: 'k1',
                    value: createRangeProgressMessage('ImportRangeStarted'),
                    headers: []
                });

                expect(logError).toHaveBeenCalledWith(
                    'Failed to parse bulk import range-progress Kafka message',
                    expect.objectContaining({ error: expect.stringContaining('bulkImportWorkerSecret is not configured') })
                );
                expect(updateOneAsync).not.toHaveBeenCalled();
            });
        });

        describe('ImportRangeStarted', () => {
            test('flips a requested Task to in-progress', async () => {
                const { handler: h, updateOneAsync } = createHandlerCapturingTaskWrites({ status: 'requested' });

                await h.handleMessageAsync({
                    key: 'k1',
                    value: createRangeProgressMessage('ImportRangeStarted'),
                    headers: []
                });

                expect(updateOneAsync).toHaveBeenCalledWith(
                    expect.objectContaining({ doc: expect.objectContaining({ status: 'in-progress' }) })
                );
            });

            test('is a no-op if the Task is already past requested', async () => {
                const { handler: h, updateOneAsync } = createHandlerCapturingTaskWrites({ status: 'in-progress' });

                await h.handleMessageAsync({
                    key: 'k1',
                    value: createRangeProgressMessage('ImportRangeStarted'),
                    headers: []
                });

                expect(updateOneAsync).not.toHaveBeenCalled();
            });

            test('logs and returns if the Task cannot be found', async () => {
                const updateOneAsync = jestGlobal.fn().mockResolvedValue(undefined);
                const handlerInstance = createHandler({}, {
                    databaseQueryFactory: {
                        createQuery: jestGlobal.fn(() => ({ findOneAsync: jestGlobal.fn().mockResolvedValue(null) }))
                    },
                    databaseUpdateFactory: {
                        createDatabaseUpdateManager: jestGlobal.fn(() => ({ updateOneAsync }))
                    }
                });

                await handlerInstance.handleMessageAsync({
                    key: 'k1',
                    value: createRangeProgressMessage('ImportRangeStarted', { taskId: 'task-missing' }),
                    headers: []
                });

                expect(logError).toHaveBeenCalledWith(
                    'Task not found for bulk import range-progress message',
                    expect.objectContaining({ taskId: 'task-missing' })
                );
                expect(updateOneAsync).not.toHaveBeenCalled();
            });
        });

        describe('ImportRangeFailed', () => {
            test('marks a non-terminal Task failed with the reported error message', async () => {
                const { handler: h, updateOneAsync } = createHandlerCapturingTaskWrites({ status: 'in-progress' });

                await h.handleMessageAsync({
                    key: 'k1',
                    value: createRangeProgressMessage('ImportRangeFailed', { errorMessage: 'S3 read timed out' }),
                    headers: []
                });

                expect(updateOneAsync).toHaveBeenCalledWith(
                    expect.objectContaining({
                        doc: expect.objectContaining({
                            status: 'failed',
                            statusReason: expect.objectContaining({ text: 'S3 read timed out' })
                        })
                    })
                );
            });

            // A range's failure report can arrive after every other range already completed
            // the Task (e.g. redelivered, or simply slow) -- since the worker never checks
            // Task state itself, this guard is the orchestrator's alone to enforce.
            test('does not regress an already-completed Task back to failed', async () => {
                const { handler: h, updateOneAsync } = createHandlerCapturingTaskWrites({ status: 'completed' });

                await h.handleMessageAsync({
                    key: 'k1',
                    value: createRangeProgressMessage('ImportRangeFailed', { errorMessage: 'too late' }),
                    headers: []
                });

                expect(updateOneAsync).not.toHaveBeenCalled();
            });
        });

        describe('ImportRangeCompleted', () => {
            test('appends result and error output entries stamped with a stable range id', async () => {
                const { handler: h, updateOneAsync } = createHandlerCapturingTaskWrites({
                    status: 'in-progress', output: []
                });

                await h.handleMessageAsync({
                    key: 'k1',
                    value: createRangeProgressMessage('ImportRangeCompleted', {
                        filepath: 's3://allowed-bucket/Patient.ndjson',
                        rangeIndex: 0,
                        taskTotalRanges: 2,
                        resultUri: 's3://allowed-bucket/output/Patient-001.ndjson',
                        errorUri: 's3://allowed-bucket/output/errors/Patient-001-errors.ndjson'
                    }),
                    headers: []
                });

                const rangeEntryId = h.buildRangeOutputEntryId({
                    filepath: 's3://allowed-bucket/Patient.ndjson', rangeIndex: 0
                });
                expect(updateOneAsync).toHaveBeenCalledWith(
                    expect.objectContaining({
                        doc: expect.objectContaining({
                            output: [
                                {
                                    id: `${rangeEntryId}-result`,
                                    type: { text: 'result' },
                                    valueUri: 's3://allowed-bucket/output/Patient-001.ndjson'
                                },
                                {
                                    id: `${rangeEntryId}-error`,
                                    type: { text: 'error' },
                                    valueUri: 's3://allowed-bucket/output/errors/Patient-001-errors.ndjson'
                                }
                            ]
                        })
                    })
                );
                // Only 1 of 2 task-wide ranges has reported -- must not complete yet, so
                // updateOneAsync is called exactly once (the output append), not a second
                // time for a status flip.
                expect(updateOneAsync).toHaveBeenCalledTimes(1);
            });

            test('stamps a placeholder output entry for a range with no created/failed resources', async () => {
                const { handler: h, updateOneAsync } = createHandlerCapturingTaskWrites({
                    status: 'in-progress', output: []
                });

                await h.handleMessageAsync({
                    key: 'k1',
                    value: createRangeProgressMessage('ImportRangeCompleted', {
                        taskTotalRanges: 2, resultUri: null, errorUri: null
                    }),
                    headers: []
                });

                const rangeEntryId = h.buildRangeOutputEntryId({
                    filepath: 's3://allowed-bucket/data/patients.ndjson', rangeIndex: 0
                });
                expect(updateOneAsync).toHaveBeenCalledWith(
                    expect.objectContaining({
                        doc: expect.objectContaining({
                            output: [{ id: rangeEntryId, type: { text: 'empty' } }]
                        })
                    })
                );
            });

            test('flips the Task to completed once every range has reported', async () => {
                const rangeEntryId0 = 'bulk-import-range:s3://allowed-bucket/data/patients.ndjson#0';
                const { handler: h, updateOneAsync } = createHandlerCapturingTaskWrites({
                    status: 'in-progress',
                    output: [{ id: `${rangeEntryId0}-result`, type: { text: 'result' }, valueUri: 's3://x' }]
                });

                await h.handleMessageAsync({
                    key: 'k1',
                    value: createRangeProgressMessage('ImportRangeCompleted', {
                        rangeIndex: 1,
                        taskTotalRanges: 2,
                        resultUri: 's3://allowed-bucket/output/Patient-002.ndjson',
                        errorUri: null
                    }),
                    headers: []
                });

                // First call appends this range's output; second call flips status once
                // countCompletedRanges sees both ranges represented.
                expect(updateOneAsync).toHaveBeenCalledTimes(2);
                expect(updateOneAsync).toHaveBeenNthCalledWith(2,
                    expect.objectContaining({ doc: expect.objectContaining({ status: 'completed' }) })
                );
            });

            test('is a no-op if the Task already reached completed (redelivery)', async () => {
                const { handler: h, updateOneAsync } = createHandlerCapturingTaskWrites({ status: 'completed' });

                await h.handleMessageAsync({
                    key: 'k1',
                    value: createRangeProgressMessage('ImportRangeCompleted', {
                        resultUri: 's3://allowed-bucket/output/Patient-001.ndjson', errorUri: null
                    }),
                    headers: []
                });

                expect(updateOneAsync).not.toHaveBeenCalled();
            });

            test('is a no-op if this exact range was already recorded (redelivery before completion)', async () => {
                const rangeEntryId = 'bulk-import-range:s3://allowed-bucket/data/patients.ndjson#0';
                const { handler: h, updateOneAsync } = createHandlerCapturingTaskWrites({
                    status: 'in-progress',
                    output: [{ id: `${rangeEntryId}-result`, type: { text: 'result' }, valueUri: 's3://x' }]
                });

                await h.handleMessageAsync({
                    key: 'k1',
                    value: createRangeProgressMessage('ImportRangeCompleted', {
                        taskTotalRanges: 2,
                        resultUri: 's3://allowed-bucket/output/Patient-001.ndjson',
                        errorUri: null
                    }),
                    headers: []
                });

                expect(updateOneAsync).not.toHaveBeenCalled();
            });
        });
    });

    // =========================================================================
    // countCompletedRanges
    // =========================================================================
    describe('countCompletedRanges', () => {
        test('returns 0 for a Task with no output entries', () => {
            expect(handler.countCompletedRanges({ output: [] })).toBe(0);
        });

        test('returns 0 when output is undefined', () => {
            expect(handler.countCompletedRanges({})).toBe(0);
        });

        test('counts a range with both a result and an error entry as one range, not two', () => {
            const rangeEntryId = 'bulk-import-range:s3://bucket/a.ndjson#0';
            const task = {
                output: [
                    { id: `${rangeEntryId}-result`, type: { text: 'result' }, valueUri: 's3://x' },
                    { id: `${rangeEntryId}-error`, type: { text: 'error' }, valueUri: 's3://y' }
                ]
            };
            expect(handler.countCompletedRanges(task)).toBe(1);
        });

        test('counts multiple distinct ranges', () => {
            const task = {
                output: [
                    { id: 'bulk-import-range:s3://bucket/a.ndjson#0-result', type: { text: 'result' }, valueUri: 's3://x' },
                    { id: 'bulk-import-range:s3://bucket/a.ndjson#1-result', type: { text: 'result' }, valueUri: 's3://y' },
                    { id: 'bulk-import-range:s3://bucket/b.ndjson#0', type: { text: 'empty' } }
                ]
            };
            expect(handler.countCompletedRanges(task)).toBe(3);
        });

        test('ignores output entries without a bulk-import-range id', () => {
            const task = {
                output: [
                    { type: { text: 'error' }, valueUri: 's3://some-other-unrelated-output' }
                ]
            };
            expect(handler.countCompletedRanges(task)).toBe(0);
        });
    });
});
