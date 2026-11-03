const moment = require('moment-timezone');
const deepcopy = require('deepcopy');
const { ReadPreference } = require('mongodb');
const { assertTypeEquals } = require('../../../utils/assertType');
const { DatabaseQueryFactory } = require('../../../dataLayer/databaseQueryFactory');
const { FastDatabaseBulkInserter } = require('../../../dataLayer/fastDatabaseBulkInserter');
const { MergeManager } = require('../../merge/mergeManager');
const { FhirRequestInfo } = require('../../../utils/fhirRequestInfo');
const { generateUUID } = require('../../../utils/uid.util');
const { BULK_IMPORT_TASK } = require('../../../constants');
const { logError, logInfo } = require('../../common/logging');
const { recordImportTaskFinished, IMPORT_TASK_STATUS } = require('../../../utils/metrics');

/**
 * Seconds from Task.authoredOn to now, or undefined when authoredOn is absent or unparseable,
 * so the caller can skip the duration histogram instead of recording a bogus value.
 * @param {Object} task
 * @returns {number|undefined}
 */
function taskDurationSeconds(task) {
    const authoredOn = task.authoredOn ? new Date(task.authoredOn).getTime() : NaN;
    if (!Number.isFinite(authoredOn)) {
        return undefined;
    }
    return Math.max(0, (Date.now() - authoredOn) / 1000);
}

/**
 * Handles the Task resource state machine for bulk import orchestration.
 *
 * The orchestrator is the only service that writes a Task's status/output once it exists --
 * workers publish range-progress events and this class processes them. In steady state a Task
 * has one writer, but not during a consumer-group handoff (rebalance, deploy, pod loss): the
 * previous owner can still be finishing an in-flight handler while the new owner starts on the
 * same Task. Every write here is therefore safe to run concurrently with another one:
 * - the range-output append omits status, so a stale copy cannot overwrite a newer status;
 * - a status write re-reads the Task from the primary first and never changes a terminal one;
 * - completion is counted on the persisted Task, not on the copy this process wrote;
 * - every range-progress event can finalize a Task, so no single event has to be the one.
 * Do not remove those on the assumption that there is only ever one writer.
 *
 * Task writes go through mergeManager.mergeResourceAsync (the same path as $merge API writes)
 * for consistent validation, upsert semantics, and pre/post-save handling. After each
 * mergeResourceAsync call, fastDatabaseBulkInserter.executeAsync is called to flush the
 * buffered write to MongoDB immediately (the same pattern $merge uses).
 */
class BulkImportTaskStateMachine {
    /**
     * @param {Object} params
     * @param {DatabaseQueryFactory} params.databaseQueryFactory
     * @param {FastDatabaseBulkInserter} params.fastDatabaseBulkInserter
     * @param {MergeManager} params.mergeManager
     */
    constructor({ databaseQueryFactory, fastDatabaseBulkInserter, mergeManager }) {
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);

        this.fastDatabaseBulkInserter = fastDatabaseBulkInserter;
        assertTypeEquals(fastDatabaseBulkInserter, FastDatabaseBulkInserter);

        this.mergeManager = mergeManager;
        assertTypeEquals(mergeManager, MergeManager);
    }

    /**
     * Builds a FhirRequestInfo for orchestrator-initiated Task writes.
     * The orchestrator runs as a service principal with no user/scope context.
     * @returns {FhirRequestInfo}
     */
    buildOrchestratorRequestInfo() {
        return new FhirRequestInfo({
            user: null,
            scope: null,
            remoteIpAddress: null,
            requestId: generateUUID(),
            userRequestId: null,
            protocol: 'kafka',
            originalUrl: '$import',
            path: '$import',
            host: null,
            body: null,
            accept: 'application/fhir+json',
            isUser: false,
            userType: null,
            personIdFromJwtToken: null,
            masterPersonIdFromJwtToken: null,
            managingOrganizationId: null,
            headers: {},
            method: 'POST',
            contentTypeFromHeader: null,
            alternateUserId: null,
            actor: null,
            purposeOfUse: null
        });
    }

    /**
     * Loads a bulk-import Task by id. Restricts the query to Tasks carrying the bulk-import
     * code so a message with an arbitrary taskId cannot mutate a non-import Task.
     *
     * Reads from the primary: every range completion is a read-modify-write of Task.output, and
     * a secondary that has not yet replicated the previous completion hands back a stale Task,
     * so the next write drops that completion's output entry.
     * @param {string} taskId
     * @returns {Promise<Object|null>}
     */
    async loadTaskAsync(taskId) {
        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: 'Task',
            base_version: '4_0_0'
        });
        return databaseQueryManager.fastFindOneAsync({
            query: {
                id: taskId,
                'code.coding': {
                    $elemMatch: {
                        system: BULK_IMPORT_TASK.TYPE_SYSTEM,
                        code: BULK_IMPORT_TASK.TYPE_CODE
                    }
                }
            },
            options: { readPreference: ReadPreference.PRIMARY }
        });
    }

    /**
     * Writes an updated Task through the merge flow (mergeManager.mergeResourceAsync),
     * which handles FHIR validation, proper upsert semantics, and pre/post-save processing.
     * @param {Object} task - copied Task resource with updated fields already applied
     * @returns {Promise<boolean>} true when the write reached the database, false when the merge
     *   rejected it as invalid (deterministic, logged, not worth retrying)
     * @throws {Error} when the database flush rejected the write (transient; the message retries)
     */
    async writeTaskAsync(task) {
        const requestInfo = this.buildOrchestratorRequestInfo();
        // mergeResourceAsync validates against the FHIR JSON schema, which expects date/dateTime
        // fields as ISO strings, not Date objects. A JSON roundtrip converts all Date values to
        // strings before the validator sees them.
        const taskJson = JSON.parse(JSON.stringify(task));
        const result = await this.mergeManager.mergeResourceAsync({
            resourceToMerge: taskJson,
            resourceType: 'Task',
            base_version: '4_0_0',
            requestInfo
        });
        if (result) {
            logError('Task merge returned a validation failure during orchestrator write', {
                taskId: task.id,
                error: result.issue?.[0]?.diagnostics
            });
            return false;
        }
        // mergeResourceAsync buffers the write in FastDatabaseBulkInserter;
        // flush it now so the Task is persisted before this call returns.
        const flushResults = await this.fastDatabaseBulkInserter.executeAsync({
            requestInfo,
            base_version: '4_0_0'
        });
        // The flush reports a rejected write as a result entry with an issue, not a throw.
        const rejected = (flushResults || []).find((r) => r && r.issue);
        if (rejected) {
            const error = rejected.issue.diagnostics || rejected.issue.code;
            logError('Task write was rejected during orchestrator flush', { taskId: task.id, error });
            throw new Error(`Task ${task.id} write was rejected during flush: ${error}`);
        }
        return true;
    }

    /**
     * Updates a Task's status (and optional statusReason) through the merge flow.
     *
     * Re-reads the Task from the primary first and builds the write from that copy, not from the
     * caller's: the caller's may be stale, and $merge applies scalars like status over whatever is
     * persisted. Never changes a terminal Task, never rewrites a status that is already set, and
     * only moves requested -> in-progress. A terminal status is counted in the task metrics once,
     * here, when this call persists it.
     * @param {Object} task
     * @param {string} status
     * @param {string} [statusReason]
     * @returns {Promise<boolean>} true when this call wrote the status
     */
    async updateTaskStatusAsync(task, status, statusReason) {
        const current = (await this.loadTaskAsync(task.id)) || task;
        const skip =
            current.status === 'completed' ||
            current.status === 'failed' ||
            current.status === status ||
            (status === 'in-progress' && current.status !== 'requested');
        if (skip) {
            return false;
        }

        const updated = deepcopy(current);
        updated.status = status;
        updated.meta.lastUpdated = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ss.SSSZ'));
        if (statusReason) {
            if (!updated.statusReason) {
                updated.statusReason = {};
            }
            updated.statusReason.text = statusReason;
        }
        const persisted = await this.writeTaskAsync(updated);
        if (persisted && status === 'completed') {
            recordImportTaskFinished(IMPORT_TASK_STATUS.COMPLETED, taskDurationSeconds(current));
        } else if (persisted && status === 'failed') {
            recordImportTaskFinished(IMPORT_TASK_STATUS.FAILED, taskDurationSeconds(current));
        }
        return persisted;
    }

    /**
     * Flips a Task from 'requested' to 'in-progress' the first time any range reports
     * having started. Any later start report (a redelivered or duplicate range run) is also a
     * chance to finalize a Task whose last completion was recorded but never counted.
     * @param {Object} task
     * @param {Object} [params]
     * @param {number} [params.taskTotalRanges]
     * @returns {Promise<void>}
     */
    async handleRangeStartedAsync(task, { taskTotalRanges } = {}) {
        if (task.status === 'requested') {
            await this.updateTaskStatusAsync(task, 'in-progress');
            return;
        }
        await this.finalizeIfCompleteAsync(task, taskTotalRanges);
    }

    /**
     * Flips a non-terminal Task to 'completed' when every range is recorded on it. Runs on
     * every range-progress event, not only the one that appends the last entry: two
     * orchestrator processes handling completions for the same Task (a rebalance leaves the
     * evicted member finishing its in-flight handler) can each persist an entry that the other
     * never sees, so the handler that appended the last entry may count one short.
     * @param {Object} task - as read from the primary
     * @param {number|undefined} taskTotalRanges
     * @returns {Promise<boolean>} true when this call completed the Task
     */
    async finalizeIfCompleteAsync(task, taskTotalRanges) {
        if (task.status === 'completed' || task.status === 'failed') {
            return false;
        }
        if (!Number.isInteger(taskTotalRanges) || taskTotalRanges <= 0) {
            return false;
        }
        if (this.countCompletedRanges(task) < taskTotalRanges) {
            return false;
        }
        return this.updateTaskStatusAsync(task, 'completed');
    }

    /**
     * Marks a Task 'failed'. A terminal Task is never written again: a late or redelivered
     * failure report must not regress a 'completed' Task, and a second failure report for a
     * 'failed' Task would only churn meta.lastUpdated.
     * @param {Object} task
     * @param {string} [errorMessage]
     * @returns {Promise<void>}
     */
    async handleRangeFailedAsync(task, errorMessage) {
        if (task.status === 'completed' || task.status === 'failed') {
            return;
        }
        await this.updateTaskStatusAsync(task, 'failed', errorMessage);
    }

    /**
     * Appends this range's result/error S3 URIs to Task.output, then flips the Task to
     * 'completed' once every range of every input file has reported in. A 'failed' Task still
     * records the entry (the client can see what landed) but never changes status again.
     * @param {Object} task
     * @param {Object} params
     * @param {string} params.filepath
     * @param {number} params.rangeIndex
     * @param {number} params.taskTotalRanges
     * @param {string|null} params.resultUri
     * @param {string|null} params.errorUri
     * @returns {Promise<void>}
     */
    async handleRangeCompletedAsync(task, { filepath, rangeIndex, taskTotalRanges, resultUri, errorUri }) {
        if (task.status === 'completed') {
            return;
        }

        if (this.isRangeRecorded(task, { filepath, rangeIndex })) {
            // Redelivered report: nothing to append, but the Task may be sitting with every
            // range recorded and no status flip (see finalizeIfCompleteAsync).
            await this.finalizeIfCompleteAsync(task, taskTotalRanges);
            return;
        }
        const rangeEntryId = this.buildRangeOutputEntryId({ filepath, rangeIndex });

        const newOutputs = [];
        if (resultUri) {
            newOutputs.push({ id: `${rangeEntryId}-result`, type: { text: 'result' }, valueUri: resultUri });
        }
        if (errorUri) {
            newOutputs.push({ id: `${rangeEntryId}-error`, type: { text: 'error' }, valueUri: errorUri });
        }
        if (newOutputs.length === 0) {
            newOutputs.push({ id: rangeEntryId, type: { text: 'empty' } });
        }

        const updated = deepcopy(task);
        updated.output = [...(updated.output || []), ...newOutputs];
        updated.meta.lastUpdated = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ss.SSSZ'));
        // Append only: status and statusReason are left out of the write so a stale copy cannot
        // overwrite a status another process has since persisted ($merge keeps the persisted
        // value for a field the incoming resource does not carry).
        const appendOnly = deepcopy(updated);
        delete appendOnly.status;
        delete appendOnly.statusReason;
        if (!(await this.writeTaskAsync(appendOnly))) {
            // Rejected as invalid (already logged). Retrying cannot change that, so don't.
            return;
        }

        // Count what is in the database, not the copy this process wrote: $merge unions
        // Task.output by entry id, so a concurrent writer's entries are present on the
        // persisted document but absent from `updated`. The entry above is already persisted,
        // so if the reload fails fall back to the local copy rather than retry the message.
        let persisted = updated;
        try {
            persisted = (await this.loadTaskAsync(task.id)) || updated;
        } catch (e) {
            logError('Failed to reload Task after recording a range; counting the local copy', {
                taskId: task.id,
                error: e.message
            });
        }

        // One line per recorded range so a stalled import is visible: an in-progress Task
        // with no progress line for N minutes is the alert.
        logInfo('Bulk import task progress', {
            taskId: task.id,
            status: persisted.status,
            completedRanges: this.countCompletedRanges(persisted),
            taskTotalRanges
        });

        await this.finalizeIfCompleteAsync(persisted, taskTotalRanges);
    }

    /**
     * Whether this range's completion is already recorded on the Task.
     * @param {Object} task
     * @param {Object} params
     * @param {string} params.filepath
     * @param {number} params.rangeIndex
     * @returns {boolean}
     */
    isRangeRecorded(task, { filepath, rangeIndex }) {
        const rangeEntryId = this.buildRangeOutputEntryId({ filepath, rangeIndex });
        return (task.output || []).some((o) =>
            typeof o.id === 'string' && (o.id === rangeEntryId || o.id.startsWith(`${rangeEntryId}-`))
        );
    }

    /**
     * The stable id stamped on every Task.output entry for a range's completion report.
     * @param {Object} params
     * @param {string} params.filepath
     * @param {number} params.rangeIndex
     * @returns {string}
     */
    buildRangeOutputEntryId({ filepath, rangeIndex }) {
        return `bulk-import-range:${filepath}#${rangeIndex}`;
    }

    /**
     * Counts distinct ranges already recorded as complete on this Task.
     * @param {Object} task
     * @returns {number}
     */
    countCompletedRanges(task) {
        const rangeIds = (task.output || [])
            .map((o) => o.id)
            .filter((id) => typeof id === 'string' && id.startsWith('bulk-import-range:'))
            .map((id) => id.replace(/-(result|error)$/, ''));
        return new Set(rangeIds).size;
    }
}

module.exports = { BulkImportTaskStateMachine };
