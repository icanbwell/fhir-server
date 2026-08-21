/**
 * Unit tests for BulkImportHandler.
 *
 * Covers:
 * - parseTaskCreatedEvent: validation of event type, taskId, and handling of untrusted fields
 * - headS3FilesAsync: S3 bucket allowlist enforcement, URI validation, file size checks
 * - handleMessageAsync: end-to-end message handling, logging of sensitive data
 * - handleRangeProgressEventAsync (ImportRangeStarted/ImportRangeCompleted/ImportRangeFailed):
 *   the orchestrator's role as the sole writer of a Task's status/output once it exists
 *
 * Security-critical scenarios are documented inline.
 */
const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

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
 * BulkImportTaskStateMachine.updateTaskStatusAsync).
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
 * Creates a mock BulkImportTaskStateMachine. Defaults simulate the happy path
 * (Task found) so individual tests only need to override what's relevant.
 * @param {Object} [overrides]
 */
function createMockStateMachine(overrides = {}) {
    return {
        loadTaskAsync: jestGlobal.fn().mockResolvedValue(createMockTask()),
        handleRangeStartedAsync: jestGlobal.fn().mockResolvedValue(undefined),
        handleRangeCompletedAsync: jestGlobal.fn().mockResolvedValue(undefined),
        handleRangeFailedAsync: jestGlobal.fn().mockResolvedValue(undefined),
        updateTaskStatusAsync: jestGlobal.fn().mockResolvedValue(undefined),
        ...overrides
    };
}

/**
 * Creates a BulkImportHandler with mock dependencies. Defaults simulate the happy path
 * so individual tests only need to override what's actually relevant to them.
 * @param {Object} [configOverrides] - ConfigManager overrides
 * @param {Object} [depsOverrides] - Constructor dependency overrides
 * @returns {BulkImportHandler}
 */
function createHandler(configOverrides = {}, depsOverrides = {}) {
    return new BulkImportHandler({
        configManager: createMockConfigManager(configOverrides),
        kafkaClientV2: {},
        bulkImportEventProducer: {
            publishImportEventsAsync: jestGlobal.fn().mockResolvedValue(1)
        },
        bulkImportTaskStateMachine: createMockStateMachine(),
        databaseQueryFactory: {
            createQuery: jestGlobal.fn(() => ({
                findOneAsync: jestGlobal.fn().mockResolvedValue(createMockTask())
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
        });

        test('throws if the event type is not TaskCreated', () => {
            const msg = JSON.stringify({
                specversion: '1.0', id: 'e1', source: 'x',
                type: 'SomethingElse', datacontenttype: 'application/json',
                data: { taskId: 'task-abc' }
            });
            expect(() => handler.parseTaskCreatedEvent(msg)).toThrow('Unexpected event type');
        });

        test('throws if taskId is missing', () => {
            const msg = JSON.stringify({
                specversion: '1.0', id: 'e1', source: 'x',
                type: 'TaskCreated', datacontenttype: 'application/json',
                data: {}
            });
            expect(() => handler.parseTaskCreatedEvent(msg)).toThrow('taskId');
        });

        // The scope, user, and other identity fields in a TaskCreated event come from the
        // original $import request context persisted by ImportOperation. They are NOT trusted
        // from the Kafka message on the orchestrator side -- the orchestrator never re-uses
        // scope/user to authorize actions; it only reads the Task by ID using the state machine.
        test('returns scope and user as-is from the event (orchestrator does not re-validate them)', () => {
            const msg = createTaskCreatedMessage({
                scope: 'system/*.write',
                user: 'practitioner/dr-evil'
            });
            const result = handler.parseTaskCreatedEvent(msg);
            expect(result.scope).toBe('system/*.write');
            expect(result.user).toBe('practitioner/dr-evil');
        });
    });

    // =========================================================================
    // headS3FilesAsync: bucket allowlist and file-size enforcement
    // =========================================================================
    describe('headS3FilesAsync', () => {
        describe('bucket allowlist', () => {
            test('succeeds for URIs in the allowed bucket list', async () => {
                mockSend.mockResolvedValue({ ContentLength: 5 * 1024 * 1024 });
                const result = await handler.headS3FilesAsync([
                    { url: 's3://allowed-bucket/some/path.ndjson' }
                ]);
                expect(result).toHaveLength(1);
                expect(result[0].url).toBe('s3://allowed-bucket/some/path.ndjson');
            });

            test('throws for a URI in a disallowed bucket', async () => {
                await expect(handler.headS3FilesAsync([
                    { url: 's3://evil-bucket/some/path.ndjson' }
                ])).rejects.toThrow('not in the allowed list');
            });

            test('throws for a non-S3 URI', async () => {
                await expect(handler.headS3FilesAsync([
                    { url: 'https://example.com/data.ndjson' }
                ])).rejects.toThrow('Invalid S3 URI');
            });
        });

        describe('file size checks', () => {
            test('throws if the file is below the minimum size', async () => {
                mockSend.mockResolvedValue({ ContentLength: 100 }); // non-zero but below 1 MB
                const h = createHandler({ bulkImportMinFileSizeMb: 1 });
                await expect(h.headS3FilesAsync([
                    { url: 's3://allowed-bucket/empty.ndjson' }
                ])).rejects.toThrow('minimum of');
            });

            test('throws if the file exceeds the maximum size', async () => {
                mockSend.mockResolvedValue({ ContentLength: 10 * 1024 * 1024 * 1024 });
                const h = createHandler({ bulkImportMaxFileSizeGb: 5 });
                await expect(h.headS3FilesAsync([
                    { url: 's3://allowed-bucket/huge.ndjson' }
                ])).rejects.toThrow('above the maximum');
            });

            test('throws if S3 HEAD returns no ContentLength', async () => {
                mockSend.mockResolvedValue({});
                await expect(handler.headS3FilesAsync([
                    { url: 's3://allowed-bucket/no-size.ndjson' }
                ])).rejects.toThrow('ContentLength');
            });
        });

        describe('S3 error handling', () => {
            test('throws if S3 HEAD returns a NotFound error', async () => {
                mockSend.mockRejectedValue(Object.assign(new Error('NotFound'), { name: 'NotFound' }));
                await expect(handler.headS3FilesAsync([
                    { url: 's3://allowed-bucket/missing.ndjson' }
                ])).rejects.toThrow();
            });
        });
    });

    // =========================================================================
    // handleMessageAsync: end-to-end TaskCreated flow
    // =========================================================================
    describe('handleMessageAsync (TaskCreated)', () => {
        test('loads the Task, heads S3 files, and publishes import events', async () => {
            const publishImportEventsAsync = jestGlobal.fn().mockResolvedValue(3);
            const stateMachine = createMockStateMachine();
            handler = createHandler({}, {
                bulkImportEventProducer: { publishImportEventsAsync },
                bulkImportTaskStateMachine: stateMachine
            });

            const message = {
                key: 'task-abc-123',
                value: createTaskCreatedMessage({
                    taskId: 'task-abc-123',
                    inputs: [
                        { url: 's3://allowed-bucket/data/patients.ndjson' },
                        { url: 's3://allowed-bucket/data/observations.ndjson' },
                        { url: 's3://allowed-bucket/data/conditions.ndjson' }
                    ],
                    user: 'practitioner/dr-smith',
                    alternateUserId: 'alt-dr-smith',
                    isUser: true,
                    remoteIpAddress: '10.0.0.1'
                }),
                headers: []
            };

            await handler.handleMessageAsync(message);

            expect(stateMachine.loadTaskAsync).toHaveBeenCalledWith('task-abc-123');
            expect(publishImportEventsAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    taskId: 'task-abc-123',
                    user: 'practitioner/dr-smith',
                    alternateUserId: 'alt-dr-smith',
                    isUser: true,
                    remoteIpAddress: '10.0.0.1'
                })
            );
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
                bulkImportTaskStateMachine: createMockStateMachine()
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
                bulkImportTaskStateMachine: createMockStateMachine({
                    loadTaskAsync: jestGlobal.fn().mockResolvedValue(null)
                })
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
            const stateMachine = createMockStateMachine();
            handler = createHandler({}, {
                bulkImportEventProducer: { publishImportEventsAsync },
                bulkImportTaskStateMachine: stateMachine
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
            expect(stateMachine.updateTaskStatusAsync).toHaveBeenCalledWith(
                expect.anything(),
                'failed',
                expect.any(String)
            );
        });
    });

    // =========================================================================
    // handleRangeProgressEventAsync: ImportRangeStarted/ImportRangeCompleted/ImportRangeFailed
    //
    // The worker never touches the Task resource -- these events drive the ONLY writes to a
    // Task once it exists, delegated to BulkImportTaskStateMachine. Each test verifies that
    // the correct state machine method is called with the right arguments.
    // =========================================================================
    describe('handleRangeProgressEventAsync', () => {
        /**
         * @param {Object} [stateMachineOverrides]
         * @returns {{ handler: BulkImportHandler, stateMachine: Object }}
         */
        function createHandlerWithStateMachine(stateMachineOverrides = {}) {
            const stateMachine = createMockStateMachine(stateMachineOverrides);
            const handlerInstance = createHandler({}, {
                bulkImportTaskStateMachine: stateMachine
            });
            return { handler: handlerInstance, stateMachine };
        }

        describe('ImportRangeStarted', () => {
            test('delegates to state machine handleRangeStartedAsync', async () => {
                const task = createMockTask({ status: 'requested' });
                const { handler: h, stateMachine } = createHandlerWithStateMachine({
                    loadTaskAsync: jestGlobal.fn().mockResolvedValue(task)
                });

                await h.handleMessageAsync({
                    key: 'k1',
                    value: createRangeProgressMessage('ImportRangeStarted'),
                    headers: []
                });

                expect(stateMachine.handleRangeStartedAsync).toHaveBeenCalledWith(task);
            });

            test('logs and returns if the Task cannot be found', async () => {
                const { handler: h, stateMachine } = createHandlerWithStateMachine({
                    loadTaskAsync: jestGlobal.fn().mockResolvedValue(null)
                });

                await h.handleMessageAsync({
                    key: 'k1',
                    value: createRangeProgressMessage('ImportRangeStarted', { taskId: 'task-missing' }),
                    headers: []
                });

                expect(logError).toHaveBeenCalledWith(
                    'Task not found for bulk import range-progress message',
                    expect.objectContaining({ taskId: 'task-missing' })
                );
                expect(stateMachine.handleRangeStartedAsync).not.toHaveBeenCalled();
            });
        });

        describe('ImportRangeFailed', () => {
            test('delegates to state machine handleRangeFailedAsync with error message', async () => {
                const task = createMockTask({ status: 'in-progress' });
                const { handler: h, stateMachine } = createHandlerWithStateMachine({
                    loadTaskAsync: jestGlobal.fn().mockResolvedValue(task)
                });

                await h.handleMessageAsync({
                    key: 'k1',
                    value: createRangeProgressMessage('ImportRangeFailed', { errorMessage: 'S3 read timed out' }),
                    headers: []
                });

                expect(stateMachine.handleRangeFailedAsync).toHaveBeenCalledWith(task, 'S3 read timed out');
            });
        });

        describe('ImportRangeCompleted', () => {
            test('delegates to state machine handleRangeCompletedAsync with all range fields', async () => {
                const task = createMockTask({ status: 'in-progress', output: [] });
                const { handler: h, stateMachine } = createHandlerWithStateMachine({
                    loadTaskAsync: jestGlobal.fn().mockResolvedValue(task)
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

                expect(stateMachine.handleRangeCompletedAsync).toHaveBeenCalledWith(
                    task,
                    expect.objectContaining({
                        filepath: 's3://allowed-bucket/Patient.ndjson',
                        rangeIndex: 0,
                        taskTotalRanges: 2,
                        resultUri: 's3://allowed-bucket/output/Patient-001.ndjson',
                        errorUri: 's3://allowed-bucket/output/errors/Patient-001-errors.ndjson'
                    })
                );
            });
        });
    });
});
