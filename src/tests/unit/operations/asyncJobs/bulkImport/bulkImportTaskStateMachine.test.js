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
const { ReadPreference } = require('mongodb');

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
const { logError, logInfo } = require('../../../../../operations/common/logging');
const metrics = require('../../../../../utils/metrics');

jestGlobal.spyOn(metrics.importTasksCounter, 'add');
jestGlobal.spyOn(metrics.importTaskDurationHistogram, 'record');

/**
 * A plain Task document as returned by fastFindOneAsync.
 * @param {Object} [overrides]
 */
let db = null;

/**
 * A Task document as persisted by $merge: scalars from the incoming resource win, a field the
 * incoming resource omits keeps its persisted value, and output entries are unioned by id.
 */
function mergeIntoDb (incoming) {
    const next = JSON.parse(JSON.stringify(incoming));
    if (!db) {
        db = next;
        return;
    }
    const byId = new Map((db.output || []).map((o) => [o.id, o]));
    for (const o of next.output || []) {
        byId.set(o.id, { ...(byId.get(o.id) || {}), ...o });
    }
    db = { ...db, ...next, output: [...byId.values()] };
}

/** The Task as currently persisted by the fake database. */
function persistedTask () {
    return JSON.parse(JSON.stringify(db));
}

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
    // Each test builds the Task it is about, which is what the fake database holds to begin with.
    db = JSON.parse(JSON.stringify(task));
    return task;
}

describe('BulkImportTaskStateMachine', () => {
    let fastFindOneAsync;
    let databaseQueryFactory;
    let fastDatabaseBulkInserter;
    let mergeManager;
    let stateMachine;

    beforeEach(() => {
        jestGlobal.clearAllMocks();

        // Stands in for the database; see mergeIntoDb for the $merge semantics it models.
        db = null;
        fastFindOneAsync = jestGlobal.fn(async () => (db ? persistedTask() : makeTask()));
        databaseQueryFactory = {
            createQuery: jestGlobal.fn(() => ({ fastFindOneAsync }))
        };
        fastDatabaseBulkInserter = {
            executeAsync: jestGlobal.fn().mockResolvedValue([{ id: 'task-1', created: false, updated: true }])
        };
        mergeManager = {
            // mergeResourceAsync returns null on success, a MergeResultEntry on validation failure
            mergeResourceAsync: jestGlobal.fn(async ({ resourceToMerge }) => {
                mergeIntoDb(resourceToMerge);
                return null;
            })
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
            expect(fastFindOneAsync).toHaveBeenCalledWith({
                query: {
                    id: 'task-xyz',
                    'code.coding': {
                        $elemMatch: {
                            system: BULK_IMPORT_TASK.TYPE_SYSTEM,
                            code: BULK_IMPORT_TASK.TYPE_CODE
                        }
                    }
                },
                options: { readPreference: ReadPreference.PRIMARY }
            });
        });

        test('reads from the primary so a lagging secondary cannot return a stale Task and drop a completed range', async () => {
            await stateMachine.loadTaskAsync('task-xyz');

            expect(fastFindOneAsync.mock.calls[0][0].options.readPreference).toBe(
                ReadPreference.PRIMARY
            );
        });

        test('RULE 10 parameter sensitivity: the taskId argument reaches the query verbatim', async () => {
            await stateMachine.loadTaskAsync('task-A');
            await stateMachine.loadTaskAsync('task-B');

            expect(fastFindOneAsync.mock.calls[0][0].query.id).toBe('task-A');
            expect(fastFindOneAsync.mock.calls[1][0].query.id).toBe('task-B');
        });

        test('returns null when no matching bulk-import Task exists', async () => {
            fastFindOneAsync.mockResolvedValue(null);
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

        test('a merge validation failure is logged, the write is NOT flushed, and the caller is told', async () => {
            mergeManager.mergeResourceAsync.mockResolvedValue({
                issue: [{ diagnostics: 'Task.status is not a valid code' }]
            });

            await expect(stateMachine.writeTaskAsync(makeTask())).resolves.toBe(false);

            expect(fastDatabaseBulkInserter.executeAsync).not.toHaveBeenCalled();
            expect(logError).toHaveBeenCalledWith(
                'Task merge returned a validation failure during orchestrator write',
                expect.objectContaining({ taskId: 'task-1' })
            );
        });

        test('reports true when the flush persisted the Task', async () => {
            await expect(stateMachine.writeTaskAsync(makeTask())).resolves.toBe(true);
        });

        test.each([
            ['an undefined flush result', undefined],
            ['an empty flush result', []]
        ])('treats %s as persisted', async (_label, flushResult) => {
            fastDatabaseBulkInserter.executeAsync.mockResolvedValue(flushResult);
            await expect(stateMachine.writeTaskAsync(makeTask())).resolves.toBe(true);
        });

        test('a write the flush rejected is logged and throws so the message retries', async () => {
            fastDatabaseBulkInserter.executeAsync.mockResolvedValue([
                { id: 'task-1', created: false, updated: false, issue: { code: 'exception', diagnostics: 'E11000 duplicate key' } }
            ]);

            await expect(stateMachine.writeTaskAsync(makeTask())).rejects.toThrow('rejected during flush');

            expect(logError).toHaveBeenCalledWith(
                'Task write was rejected during orchestrator flush',
                { taskId: 'task-1', error: 'E11000 duplicate key' }
            );
        });
    });

    // ========================================================================================
    // updateTaskStatusAsync
    // ========================================================================================
    describe('updateTaskStatusAsync', () => {
        test('writes a copy with the new status and a refreshed meta.lastUpdated', async () => {
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

        test.each([
            ['completed', 'failed'],
            ['failed', 'completed'],
            ['completed', 'in-progress'],
            ['in-progress', 'in-progress']
        ])('does not write %s -> %s when the persisted Task is already past it', async (persisted, target) => {
            const stale = makeTask({ status: 'requested' });
            db.status = persisted;

            await expect(stateMachine.updateTaskStatusAsync(stale, target)).resolves.toBe(false);

            expect(mergeManager.mergeResourceAsync).not.toHaveBeenCalled();
            expect(metrics.importTasksCounter.add).not.toHaveBeenCalled();
        });

        test('builds the write from the persisted Task, not the caller\'s stale copy', async () => {
            const stale = makeTask({ status: 'requested', output: [] });
            db.status = 'in-progress';
            db.output = [{ id: 'bulk-import-range:s3://b/P.ndjson#0-result' }];

            await expect(stateMachine.updateTaskStatusAsync(stale, 'failed', 'boom')).resolves.toBe(true);

            expect(mergedTask().output.map((o) => o.id)).toEqual(['bulk-import-range:s3://b/P.ndjson#0-result']);
            expect(persistedTask().status).toBe('failed');
        });

        test('returns false when the Task is gone from the database and uses the caller\'s copy', async () => {
            fastFindOneAsync.mockResolvedValueOnce(null);
            await expect(stateMachine.updateTaskStatusAsync(makeTask({ status: 'requested' }), 'in-progress'))
                .resolves.toBe(true);
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

        test('completes an in-progress Task that already has every range recorded', async () => {
            const task = makeTask({
                status: 'in-progress',
                output: [
                    { id: 'bulk-import-range:s3://b/P.ndjson#0-result' },
                    { id: 'bulk-import-range:s3://b/P.ndjson#1-result' }
                ]
            });

            await stateMachine.handleRangeStartedAsync(task, { taskTotalRanges: 2 });

            expect(mergeManager.mergeResourceAsync).toHaveBeenCalledTimes(1);
            expect(mergedTask().status).toBe('completed');
            expect(metrics.importTasksCounter.add).toHaveBeenCalledWith(1, { status: 'completed' });
        });

        test.each([
            ['no event data', undefined],
            ['no taskTotalRanges', {}],
            ['a non-integer taskTotalRanges', { taskTotalRanges: 'two' }],
            ['a zero taskTotalRanges', { taskTotalRanges: 0 }]
        ])('does not complete an in-progress Task given %s', async (_label, params) => {
            const task = makeTask({
                status: 'in-progress',
                output: [{ id: 'bulk-import-range:s3://b/P.ndjson#0-result' }]
            });

            await stateMachine.handleRangeStartedAsync(task, params);

            expect(mergeManager.mergeResourceAsync).not.toHaveBeenCalled();
        });

        test('only flips requested to in-progress on the first start even when every range is recorded', async () => {
            const task = makeTask({
                status: 'requested',
                output: [{ id: 'bulk-import-range:s3://b/P.ndjson#0-result' }]
            });

            await stateMachine.handleRangeStartedAsync(task, { taskTotalRanges: 1 });

            expect(mergeManager.mergeResourceAsync).toHaveBeenCalledTimes(1);
            expect(mergedTask().status).toBe('in-progress');
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

        test('is a no-op for a Task already failed (redelivered failure report)', async () => {
            await stateMachine.handleRangeFailedAsync(makeTask({ status: 'failed' }), 'again');
            expect(mergeManager.mergeResourceAsync).not.toHaveBeenCalled();
            expect(metrics.importTasksCounter.add).not.toHaveBeenCalled();
        });

        test('counts the failed Task once with its duration since authoredOn', async () => {
            const authoredOn = new Date(Date.now() - 90 * 1000).toISOString();
            await stateMachine.handleRangeFailedAsync(makeTask({ status: 'in-progress', authoredOn }), 'boom');

            expect(metrics.importTasksCounter.add).toHaveBeenCalledTimes(1);
            expect(metrics.importTasksCounter.add).toHaveBeenCalledWith(1, { status: 'failed' });
            const [duration, labels] = metrics.importTaskDurationHistogram.record.mock.calls[0];
            expect(labels).toEqual({ status: 'failed' });
            expect(duration).toBeGreaterThanOrEqual(90);
            expect(duration).toBeLessThan(120);
        });

        test('counts the failed Task but records no duration when authoredOn is absent', async () => {
            await stateMachine.handleRangeFailedAsync(makeTask({ status: 'in-progress' }), 'boom');
            expect(metrics.importTasksCounter.add).toHaveBeenCalledTimes(1);
            expect(metrics.importTaskDurationHistogram.record).not.toHaveBeenCalled();
        });

        test('throws, and counts nothing, when the failed status write is rejected', async () => {
            fastDatabaseBulkInserter.executeAsync.mockResolvedValue([{ id: 'task-1', issue: { code: 'exception' } }]);
            await expect(
                stateMachine.handleRangeFailedAsync(makeTask({ status: 'in-progress' }), 'boom')
            ).rejects.toThrow('rejected during flush');
            expect(metrics.importTasksCounter.add).not.toHaveBeenCalled();
        });

        test('does not count a failed Task whose merge was rejected as invalid, and does not throw', async () => {
            mergeManager.mergeResourceAsync.mockResolvedValue({ issue: [{ diagnostics: 'invalid' }] });
            await stateMachine.handleRangeFailedAsync(makeTask({ status: 'in-progress' }), 'boom');
            expect(metrics.importTasksCounter.add).not.toHaveBeenCalled();
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
            expect(persistedTask().status).toBe('in-progress');
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

        test('is idempotent: a redelivered completion report for a recorded range appends nothing', async () => {
            const task = makeTask({
                status: 'in-progress',
                output: [{ id: 'bulk-import-range:s3://b/Patient.ndjson#0-result' }]
            });

            await stateMachine.handleRangeCompletedAsync(task, rangeParams);

            expect(mergeManager.mergeResourceAsync).not.toHaveBeenCalled();
        });

        test('a redelivered report completes a Task that has every range recorded but was never flipped', async () => {
            // The state the prod incident left behind: all outputs present, status still in-progress.
            const task = makeTask({
                status: 'in-progress',
                output: [
                    { id: 'bulk-import-range:s3://b/Patient.ndjson#0-result' },
                    { id: 'bulk-import-range:s3://b/Patient.ndjson#1-result' }
                ]
            });

            await stateMachine.handleRangeCompletedAsync(task, rangeParams);

            expect(mergeManager.mergeResourceAsync).toHaveBeenCalledTimes(1);
            expect(mergedTask().status).toBe('completed');
            expect(mergedTask().output).toHaveLength(2);
        });

        test('counts the persisted Task, so an entry a concurrent writer added is seen', async () => {
            // This process loaded the Task with range 1 missing; by the time its write lands,
            // another orchestrator process has persisted range 1. $merge unions both.
            const task = makeTask({ status: 'in-progress', output: [] });
            fastFindOneAsync.mockResolvedValueOnce(makeTask({
                status: 'in-progress',
                output: [
                    { id: 'bulk-import-range:s3://b/Patient.ndjson#0-result' },
                    { id: 'bulk-import-range:s3://b/Patient.ndjson#1-result' }
                ]
            }));

            await stateMachine.handleRangeCompletedAsync(task, rangeParams);

            expect(mergeManager.mergeResourceAsync).toHaveBeenCalledTimes(2);
            expect(mergedTask(0).output.map((o) => o.id)).toEqual([
                'bulk-import-range:s3://b/Patient.ndjson#0-result'
            ]);
            expect(mergedTask(1).status).toBe('completed');
            expect(logInfo).toHaveBeenCalledWith('Bulk import task progress', expect.objectContaining({
                completedRanges: 2,
                taskTotalRanges: 2
            }));
        });

        test('falls back to its own copy when the Task cannot be reloaded after the write', async () => {
            const task = makeTask({
                status: 'in-progress',
                output: [{ id: 'bulk-import-range:s3://b/Patient.ndjson#1-result' }]
            });
            fastFindOneAsync.mockResolvedValueOnce(null);

            await stateMachine.handleRangeCompletedAsync(task, rangeParams);

            expect(mergedTask(1).status).toBe('completed');
        });

        test('throws when the output entry was not persisted so the message is retried', async () => {
            fastDatabaseBulkInserter.executeAsync.mockResolvedValue([{ id: 'task-1', issue: { code: 'exception' } }]);

            await expect(
                stateMachine.handleRangeCompletedAsync(makeTask({ status: 'in-progress', output: [] }), rangeParams)
            ).rejects.toThrow('rejected during flush');

            expect(mergeManager.mergeResourceAsync).toHaveBeenCalledTimes(1);
            expect(logInfo).not.toHaveBeenCalledWith('Bulk import task progress', expect.anything());
            expect(metrics.importTasksCounter.add).not.toHaveBeenCalled();
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

        test('records the entry on a failed Task but never flips it to completed', async () => {
            // Range 1 already recorded, so this completion makes the count reach taskTotalRanges.
            const task = makeTask({
                status: 'failed',
                output: [{ id: 'bulk-import-range:s3://b/Patient.ndjson#1-result' }]
            });

            await stateMachine.handleRangeCompletedAsync(task, rangeParams);

            expect(mergeManager.mergeResourceAsync).toHaveBeenCalledTimes(1);
            expect(persistedTask().status).toBe('failed');
            expect(persistedTask().output.map((o) => o.id)).toContain(
                'bulk-import-range:s3://b/Patient.ndjson#0-result'
            );
            expect(metrics.importTasksCounter.add).not.toHaveBeenCalled();
        });

        test('the output append carries no status, so a stale copy cannot overwrite a newer one', async () => {
            // This process loaded the Task in-progress; another has since persisted it as failed.
            const stale = makeTask({ status: 'in-progress', statusReason: { text: 'old' }, output: [] });
            db.status = 'failed';
            db.statusReason = { text: 'range 3 blew up' };

            await stateMachine.handleRangeCompletedAsync(stale, rangeParams);

            expect(mergedTask().status).toBeUndefined();
            expect(mergedTask().statusReason).toBeUndefined();
            expect(persistedTask().status).toBe('failed');
            expect(persistedTask().statusReason).toEqual({ text: 'range 3 blew up' });
            expect(persistedTask().output).toHaveLength(1);
            expect(metrics.importTasksCounter.add).not.toHaveBeenCalled();
        });

        test('does not complete a Task that another process has since completed', async () => {
            const stale = makeTask({
                status: 'in-progress',
                output: [{ id: 'bulk-import-range:s3://b/Patient.ndjson#1-result' }]
            });
            db.status = 'completed';

            await stateMachine.handleRangeCompletedAsync(stale, rangeParams);

            expect(mergeManager.mergeResourceAsync).toHaveBeenCalledTimes(1);
            expect(persistedTask().status).toBe('completed');
            expect(metrics.importTasksCounter.add).not.toHaveBeenCalled();
        });

        test('throws when the completed status write is rejected, so the message retries', async () => {
            const task = makeTask({
                status: 'in-progress',
                output: [{ id: 'bulk-import-range:s3://b/Patient.ndjson#1-result' }]
            });
            fastDatabaseBulkInserter.executeAsync
                .mockResolvedValueOnce([{ id: 'task-1' }])
                .mockResolvedValueOnce([{ id: 'task-1', issue: { code: 'exception' } }]);

            await expect(stateMachine.handleRangeCompletedAsync(task, rangeParams))
                .rejects.toThrow('rejected during flush');

            expect(metrics.importTasksCounter.add).not.toHaveBeenCalled();
        });

        test('a merge validation rejection of the output append is logged, not retried', async () => {
            mergeManager.mergeResourceAsync.mockResolvedValue({ issue: [{ diagnostics: 'invalid' }] });

            await expect(
                stateMachine.handleRangeCompletedAsync(makeTask({ status: 'in-progress', output: [] }), rangeParams)
            ).resolves.toBeUndefined();

            expect(fastFindOneAsync).not.toHaveBeenCalled();
            expect(logInfo).not.toHaveBeenCalledWith('Bulk import task progress', expect.anything());
            expect(logError).toHaveBeenCalledWith(
                'Task merge returned a validation failure during orchestrator write',
                expect.objectContaining({ taskId: 'task-1' })
            );
        });

        test('a failed reload after the write is logged and the local copy is counted', async () => {
            const task = makeTask({
                status: 'in-progress',
                output: [{ id: 'bulk-import-range:s3://b/Patient.ndjson#1-result' }]
            });
            fastFindOneAsync.mockRejectedValueOnce(new Error('primary unavailable'));

            await expect(stateMachine.handleRangeCompletedAsync(task, rangeParams)).resolves.toBeUndefined();

            expect(logError).toHaveBeenCalledWith(
                'Failed to reload Task after recording a range; counting the local copy',
                { taskId: 'task-1', error: 'primary unavailable' }
            );
            expect(persistedTask().status).toBe('completed');
        });

        test('logs a progress line with completed and total range counts', async () => {
            await stateMachine.handleRangeCompletedAsync(
                makeTask({ status: 'in-progress', output: [] }), { ...rangeParams, taskTotalRanges: 7 }
            );
            expect(logInfo).toHaveBeenCalledWith('Bulk import task progress', {
                taskId: 'task-1',
                status: 'in-progress',
                completedRanges: 1,
                taskTotalRanges: 7
            });
        });

        test('counts the completed Task once, with its duration, only when it completes', async () => {
            const authoredOn = new Date(Date.now() - 3600 * 1000).toISOString();

            await stateMachine.handleRangeCompletedAsync(
                makeTask({ status: 'in-progress', output: [], authoredOn }), rangeParams
            );
            expect(metrics.importTasksCounter.add).not.toHaveBeenCalled();

            await stateMachine.handleRangeCompletedAsync(
                makeTask({
                    status: 'in-progress',
                    authoredOn,
                    output: [{ id: 'bulk-import-range:s3://b/Patient.ndjson#1-result' }]
                }),
                rangeParams
            );
            expect(metrics.importTasksCounter.add).toHaveBeenCalledTimes(1);
            expect(metrics.importTasksCounter.add).toHaveBeenCalledWith(1, { status: 'completed' });
            const [duration, labels] = metrics.importTaskDurationHistogram.record.mock.calls[0];
            expect(labels).toEqual({ status: 'completed' });
            expect(duration).toBeGreaterThanOrEqual(3600);
            expect(duration).toBeLessThan(3660);
        });
    });
});
