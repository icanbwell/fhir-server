'use strict';

/**
 * Unit tests for BulkImportTaskStateMachine — the ONLY writer of a bulk-import Task's
 * status/output once the Task exists.
 *
 * Focus areas (batch B assignment):
 * - transition legality: can a Task go from a terminal state back to a running/other terminal one?
 * - idempotency of range-completion reports (Kafka redelivery)
 * - whether a FAILED Task write is reported to the caller as a SUCCESS
 * - least-privilege Task lookup (an arbitrary taskId must not be able to mutate a non-import Task)
 *
 * Tests whose name starts with "BUGB-" assert CORRECT behavior the current code does NOT
 * implement — they FAIL by design and are the bug report.
 */

const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

jestGlobal.mock('../../../../../operations/common/logging', () => ({
    logInfo: jestGlobal.fn(),
    logError: jestGlobal.fn(),
    logDebug: jestGlobal.fn(),
    logWarn: jestGlobal.fn()
}));

jestGlobal.mock('../../../../../utils/assertType', () => ({
    assertTypeEquals: () => {},
    assertIsValid: () => {},
    assertFail: () => {}
}));

const {
    BulkImportTaskStateMachine
} = require('../../../../../operations/asyncJobs/bulkImport/bulkImportTaskStateMachine');
const { FhirRequestInfo } = require('../../../../../utils/fhirRequestInfo');
const { BULK_IMPORT_TASK } = require('../../../../../constants');
const { logError } = require('../../../../../operations/common/logging');

/**
 * A Task resource double with the clone()/toJSONInternal() contract the state machine relies on.
 * clone() returns a deep-enough copy so mutation isolation is observable.
 * @param {Object} [overrides]
 */
function makeTask (overrides = {}) {
    const task = {
        resourceType: 'Task',
        id: 'task-1',
        status: 'requested',
        code: {
            coding: [{ system: BULK_IMPORT_TASK.TYPE_SYSTEM, code: BULK_IMPORT_TASK.TYPE_CODE }]
        },
        meta: { lastUpdated: new Date('2026-01-01T00:00:00.000Z') },
        ...overrides
    };
    task.meta = { ...task.meta };
    if (task.output) {
        task.output = task.output.map((o) => ({ ...o }));
    }
    task.clone = () => makeTask({
        resourceType: task.resourceType,
        id: task.id,
        status: task.status,
        code: task.code,
        meta: { ...task.meta },
        output: task.output,
        statusReason: task.statusReason ? { ...task.statusReason } : undefined
    });
    task.toJSONInternal = () => ({
        resourceType: task.resourceType,
        id: task.id,
        status: task.status,
        code: task.code,
        meta: task.meta,
        output: task.output,
        statusReason: task.statusReason
    });
    return task;
}

describe('BulkImportTaskStateMachine', () => {
    let findOneAsync;
    let databaseQueryFactory;
    let fastDatabaseBulkInserter;
    let mergeManager;
    let stateMachine;

    beforeEach(() => {
        jestGlobal.clearAllMocks();

        findOneAsync = jestGlobal.fn().mockResolvedValue(makeTask());
        databaseQueryFactory = {
            createQuery: jestGlobal.fn(() => ({ findOneAsync }))
        };
        fastDatabaseBulkInserter = {
            executeAsync: jestGlobal.fn().mockResolvedValue(undefined)
        };
        mergeManager = {
            // mergeResourceAsync returns null on success, a MergeResultEntry on validation failure
            mergeResourceAsync: jestGlobal.fn().mockResolvedValue(null)
        };

        stateMachine = new BulkImportTaskStateMachine({
            databaseQueryFactory,
            fastDatabaseBulkInserter,
            mergeManager
        });
    });

    /** The Task resource handed to mergeResourceAsync on the Nth write (0-based). */
    function mergedTask (n = 0) {
        return mergeManager.mergeResourceAsync.mock.calls[n][0].resourceToMerge;
    }

    // ========================================================================================
    // buildOrchestratorRequestInfo
    // ========================================================================================
    describe('buildOrchestratorRequestInfo', () => {
        test('builds an unauthenticated service-principal request context for Task writes', () => {
            const requestInfo = stateMachine.buildOrchestratorRequestInfo();

            expect(requestInfo).toBeInstanceOf(FhirRequestInfo);
            expect(requestInfo.user).toBeNull();
            expect(requestInfo.scope).toBeNull();
            expect(requestInfo.isUser).toBe(false);
            expect(requestInfo.protocol).toBe('kafka');
            expect(requestInfo.path).toBe('$import');
            expect(requestInfo.method).toBe('POST');
            expect(requestInfo.personIdFromJwtToken).toBeNull();
        });

        test('mints a fresh requestId per call so concurrent Task writes cannot share a write buffer', () => {
            const a = stateMachine.buildOrchestratorRequestInfo();
            const b = stateMachine.buildOrchestratorRequestInfo();

            expect(a.requestId).toEqual(expect.any(String));
            expect(a.requestId.length).toBeGreaterThan(0);
            expect(a.requestId).not.toBe(b.requestId);
        });
    });

    // ========================================================================================
    // loadTaskAsync — least-privilege lookup
    // ========================================================================================
    describe('loadTaskAsync', () => {
        test('SECURITY: restricts the lookup to Tasks carrying the bulk-import code, not just the id', async () => {
            await stateMachine.loadTaskAsync('task-xyz');

            expect(databaseQueryFactory.createQuery).toHaveBeenCalledWith({
                resourceType: 'Task',
                base_version: '4_0_0'
            });
            expect(findOneAsync).toHaveBeenCalledWith({
                query: {
                    id: 'task-xyz',
                    'code.coding': {
                        $elemMatch: {
                            system: BULK_IMPORT_TASK.TYPE_SYSTEM,
                            code: BULK_IMPORT_TASK.TYPE_CODE
                        }
                    }
                }
            });
        });

        test('RULE 10 parameter sensitivity: the taskId argument reaches the query verbatim', async () => {
            await stateMachine.loadTaskAsync('task-A');
            await stateMachine.loadTaskAsync('task-B');

            expect(findOneAsync.mock.calls[0][0].query.id).toBe('task-A');
            expect(findOneAsync.mock.calls[1][0].query.id).toBe('task-B');
        });

        test('returns null when no matching bulk-import Task exists', async () => {
            findOneAsync.mockResolvedValue(null);
            await expect(stateMachine.loadTaskAsync('nope')).resolves.toBeNull();
        });
    });

    // ========================================================================================
    // writeTaskAsync
    // ========================================================================================
    describe('writeTaskAsync', () => {
        test('merges the Task with Date fields serialized to ISO strings, then flushes the inserter', async () => {
            const task = makeTask({ status: 'in-progress' });
            await stateMachine.writeTaskAsync(task);

            expect(mergeManager.mergeResourceAsync).toHaveBeenCalledTimes(1);
            const call = mergeManager.mergeResourceAsync.mock.calls[0][0];
            expect(call.resourceType).toBe('Task');
            expect(call.base_version).toBe('4_0_0');
            expect(call.resourceToMerge.status).toBe('in-progress');
            // the FHIR JSON-schema validator rejects Date objects — must be a string by now
            expect(typeof call.resourceToMerge.meta.lastUpdated).toBe('string');
            expect(call.resourceToMerge.meta.lastUpdated).toBe('2026-01-01T00:00:00.000Z');

            expect(fastDatabaseBulkInserter.executeAsync).toHaveBeenCalledTimes(1);
            expect(fastDatabaseBulkInserter.executeAsync).toHaveBeenCalledWith(
                expect.objectContaining({ base_version: '4_0_0' })
            );
        });

        test('uses the same requestInfo for the merge and the flush so the buffered write is found', async () => {
            await stateMachine.writeTaskAsync(makeTask());

            const mergeRequestId = mergeManager.mergeResourceAsync.mock.calls[0][0].requestInfo.requestId;
            const flushRequestId = fastDatabaseBulkInserter.executeAsync.mock.calls[0][0].requestInfo.requestId;
            expect(flushRequestId).toBe(mergeRequestId);
        });

        test('a merge validation failure is logged and the write is NOT flushed', async () => {
            mergeManager.mergeResourceAsync.mockResolvedValue({
                issue: [{ diagnostics: 'Task.status is not a valid code' }]
            });

            await stateMachine.writeTaskAsync(makeTask());

            expect(fastDatabaseBulkInserter.executeAsync).not.toHaveBeenCalled();
            expect(logError).toHaveBeenCalledWith(
                'Task merge returned a validation failure during orchestrator write',
                expect.objectContaining({ taskId: 'task-1' })
            );
        });
    });

    // ========================================================================================
    // updateTaskStatusAsync
    // ========================================================================================
    describe('updateTaskStatusAsync', () => {
        test('writes a clone with the new status and a refreshed meta.lastUpdated', async () => {
            const task = makeTask({ status: 'requested' });
            const before = task.meta.lastUpdated;

            await stateMachine.updateTaskStatusAsync(task, 'in-progress');

            expect(mergedTask().status).toBe('in-progress');
            expect(new Date(mergedTask().meta.lastUpdated).getTime())
                .toBeGreaterThan(new Date(before).getTime());
        });

        test('does not mutate the caller\'s Task object', async () => {
            const task = makeTask({ status: 'requested' });
            await stateMachine.updateTaskStatusAsync(task, 'failed', 'boom');

            expect(task.status).toBe('requested');
            expect(task.statusReason).toBeUndefined();
        });

        test('records statusReason.text when a reason is supplied', async () => {
            await stateMachine.updateTaskStatusAsync(makeTask(), 'failed', 'S3 read timed out');

            expect(mergedTask().status).toBe('failed');
            expect(mergedTask().statusReason).toEqual({ text: 'S3 read timed out' });
        });

        test('leaves statusReason absent when no reason is supplied', async () => {
            await stateMachine.updateTaskStatusAsync(makeTask(), 'completed');
            expect(mergedTask().statusReason).toBeUndefined();
        });
    });

    // ========================================================================================
    // handleRangeStartedAsync — requested -> in-progress only
    // ========================================================================================
    describe('handleRangeStartedAsync', () => {
        test('flips a requested Task to in-progress', async () => {
            await stateMachine.handleRangeStartedAsync(makeTask({ status: 'requested' }));
            expect(mergedTask().status).toBe('in-progress');
        });

        test('is a no-op for a Task already in-progress (redelivered start report)', async () => {
            await stateMachine.handleRangeStartedAsync(makeTask({ status: 'in-progress' }));
            expect(mergeManager.mergeResourceAsync).not.toHaveBeenCalled();
        });

        test('never regresses a completed Task back to in-progress', async () => {
            await stateMachine.handleRangeStartedAsync(makeTask({ status: 'completed' }));
            expect(mergeManager.mergeResourceAsync).not.toHaveBeenCalled();
        });

        test('never regresses a failed Task back to in-progress', async () => {
            await stateMachine.handleRangeStartedAsync(makeTask({ status: 'failed' }));
            expect(mergeManager.mergeResourceAsync).not.toHaveBeenCalled();
        });
    });

    // ========================================================================================
    // handleRangeFailedAsync
    // ========================================================================================
    describe('handleRangeFailedAsync', () => {
        test('marks an in-progress Task failed and records the error message', async () => {
            await stateMachine.handleRangeFailedAsync(makeTask({ status: 'in-progress' }), 'range 3 blew up');

            expect(mergedTask().status).toBe('failed');
            expect(mergedTask().statusReason).toEqual({ text: 'range 3 blew up' });
        });

        test('never regresses an already-completed Task to failed', async () => {
            await stateMachine.handleRangeFailedAsync(makeTask({ status: 'completed' }), 'late failure');
            expect(mergeManager.mergeResourceAsync).not.toHaveBeenCalled();
        });

        test('tolerates a missing error message', async () => {
            await stateMachine.handleRangeFailedAsync(makeTask({ status: 'requested' }));
            expect(mergedTask().status).toBe('failed');
            expect(mergedTask().statusReason).toBeUndefined();
        });
    });

    // ========================================================================================
    // buildRangeOutputEntryId / countCompletedRanges
    // ========================================================================================
    describe('output bookkeeping helpers', () => {
        test('buildRangeOutputEntryId is stable and includes both filepath and rangeIndex', () => {
            expect(stateMachine.buildRangeOutputEntryId({ filepath: 's3://b/Patient.ndjson', rangeIndex: 2 }))
                .toBe('bulk-import-range:s3://b/Patient.ndjson#2');
            expect(stateMachine.buildRangeOutputEntryId({ filepath: 's3://b/Patient.ndjson', rangeIndex: 3 }))
                .not.toBe(stateMachine.buildRangeOutputEntryId({ filepath: 's3://b/Patient.ndjson', rangeIndex: 2 }));
        });

        test('countCompletedRanges collapses a range\'s -result and -error entries into one', () => {
            const task = makeTask({
                output: [
                    { id: 'bulk-import-range:s3://b/P.ndjson#0-result' },
                    { id: 'bulk-import-range:s3://b/P.ndjson#0-error' },
                    { id: 'bulk-import-range:s3://b/P.ndjson#1-result' }
                ]
            });
            expect(stateMachine.countCompletedRanges(task)).toBe(2);
        });

        test('countCompletedRanges counts ranges across different input files separately', () => {
            const task = makeTask({
                output: [
                    { id: 'bulk-import-range:s3://b/P.ndjson#0-result' },
                    { id: 'bulk-import-range:s3://b/O.ndjson#0-result' }
                ]
            });
            expect(stateMachine.countCompletedRanges(task)).toBe(2);
        });

        test('countCompletedRanges ignores unrelated output entries and an absent output array', () => {
            expect(stateMachine.countCompletedRanges(makeTask())).toBe(0);
            expect(stateMachine.countCompletedRanges(makeTask({
                output: [{ id: 'some-other-output' }, { type: { text: 'no id' } }]
            }))).toBe(0);
        });
    });

    // ========================================================================================
    // handleRangeCompletedAsync
    // ========================================================================================
    describe('handleRangeCompletedAsync', () => {
        const rangeParams = {
            filepath: 's3://b/Patient.ndjson',
            rangeIndex: 0,
            taskTotalRanges: 2,
            resultUri: 's3://b/output/Patient-001.ndjson',
            errorUri: null
        };

        test('appends a result output entry and does not complete while ranges are outstanding', async () => {
            await stateMachine.handleRangeCompletedAsync(makeTask({ status: 'in-progress', output: [] }), rangeParams);

            expect(mergeManager.mergeResourceAsync).toHaveBeenCalledTimes(1);
            expect(mergedTask().output).toEqual([
                {
                    id: 'bulk-import-range:s3://b/Patient.ndjson#0-result',
                    type: { text: 'result' },
                    valueUri: 's3://b/output/Patient-001.ndjson'
                }
            ]);
            expect(mergedTask().status).toBe('in-progress');
        });

        test('appends both result and error entries when the range produced failures', async () => {
            await stateMachine.handleRangeCompletedAsync(
                makeTask({ status: 'in-progress', output: [] }),
                { ...rangeParams, errorUri: 's3://b/output/errors/Patient-001-errors.ndjson' }
            );

            expect(mergedTask().output.map((o) => o.type.text)).toEqual(['result', 'error']);
            expect(mergedTask().output[1].valueUri).toBe('s3://b/output/errors/Patient-001-errors.ndjson');
        });

        test('records an "empty" marker when a range produced neither a result nor an error file', async () => {
            await stateMachine.handleRangeCompletedAsync(
                makeTask({ status: 'in-progress', output: [] }),
                { ...rangeParams, resultUri: null, errorUri: null }
            );

            expect(mergedTask().output).toEqual([
                { id: 'bulk-import-range:s3://b/Patient.ndjson#0', type: { text: 'empty' } }
            ]);
        });

        test('flips the Task to completed once every range has reported in', async () => {
            const task = makeTask({
                status: 'in-progress',
                output: [{ id: 'bulk-import-range:s3://b/Patient.ndjson#1-result' }]
            });

            await stateMachine.handleRangeCompletedAsync(task, rangeParams);

            expect(mergeManager.mergeResourceAsync).toHaveBeenCalledTimes(2);
            expect(mergedTask(1).status).toBe('completed');
        });

        test('is idempotent: a redelivered completion report for a recorded range is a no-op', async () => {
            const task = makeTask({
                status: 'in-progress',
                output: [{ id: 'bulk-import-range:s3://b/Patient.ndjson#0-result' }]
            });

            await stateMachine.handleRangeCompletedAsync(task, rangeParams);

            expect(mergeManager.mergeResourceAsync).not.toHaveBeenCalled();
        });

        test('range 1 is not mistaken for range 11 when checking whether it was already recorded', async () => {
            const task = makeTask({
                status: 'in-progress',
                output: [{ id: 'bulk-import-range:s3://b/Patient.ndjson#11-result' }]
            });

            await stateMachine.handleRangeCompletedAsync(task, {
                ...rangeParams, rangeIndex: 1, taskTotalRanges: 20
            });

            expect(mergeManager.mergeResourceAsync).toHaveBeenCalledTimes(1);
            expect(mergedTask().output.map((o) => o.id)).toContain(
                'bulk-import-range:s3://b/Patient.ndjson#1-result'
            );
        });

        test('is a no-op once the Task is already completed', async () => {
            await stateMachine.handleRangeCompletedAsync(
                makeTask({ status: 'completed', output: [] }), rangeParams
            );
            expect(mergeManager.mergeResourceAsync).not.toHaveBeenCalled();
        });
    });
});
