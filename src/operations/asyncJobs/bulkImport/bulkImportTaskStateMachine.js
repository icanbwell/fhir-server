const moment = require('moment-timezone');
const { assertTypeEquals } = require('../../../utils/assertType');
const { DatabaseQueryFactory } = require('../../../dataLayer/databaseQueryFactory');
const { FastDatabaseBulkInserter } = require('../../../dataLayer/fastDatabaseBulkInserter');
const { MergeManager } = require('../../merge/mergeManager');
const { FhirRequestInfo } = require('../../../utils/fhirRequestInfo');
const { generateUUID } = require('../../../utils/uid.util');
const { BULK_IMPORT_TASK } = require('../../../constants');
const { logError } = require('../../common/logging');

/**
 * Handles the Task resource state machine for bulk import orchestration.
 *
 * The orchestrator is the only process that ever writes a Task's status/output once it exists --
 * workers publish range-progress events and this class processes them, so there is exactly one
 * writer and no concurrent-update race to resolve.
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
     * @param {string} taskId
     * @returns {Promise<Object|null>}
     */
    async loadTaskAsync(taskId) {
        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: 'Task',
            base_version: '4_0_0'
        });
        return databaseQueryManager.findOneAsync({
            query: {
                id: taskId,
                'code.coding': {
                    $elemMatch: {
                        system: BULK_IMPORT_TASK.TYPE_SYSTEM,
                        code: BULK_IMPORT_TASK.TYPE_CODE
                    }
                }
            }
        });
    }

    /**
     * Writes an updated Task through the merge flow (mergeManager.mergeResourceAsync),
     * which handles FHIR validation, proper upsert semantics, and pre/post-save processing.
     * @param {Object} task - cloned Task resource with updated fields already applied
     * @returns {Promise<void>}
     */
    async writeTaskAsync(task) {
        const requestInfo = this.buildOrchestratorRequestInfo();
        // mergeResourceAsync validates against the FHIR JSON schema, which expects date/dateTime
        // fields as ISO strings, not Date objects. Serialize via toJSONInternal + JSON roundtrip
        // to convert all Date values to strings before the validator sees them.
        const taskJson = JSON.parse(JSON.stringify(task.toJSONInternal()));
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
            return;
        }
        // mergeResourceAsync buffers the write in FastDatabaseBulkInserter;
        // flush it now so the Task is persisted before this call returns.
        await this.fastDatabaseBulkInserter.executeAsync({
            requestInfo,
            base_version: '4_0_0'
        });
    }

    /**
     * Updates a Task's status (and optional statusReason) through the merge flow.
     * @param {Object} task
     * @param {string} status
     * @param {string} [statusReason]
     * @returns {Promise<void>}
     */
    async updateTaskStatusAsync(task, status, statusReason) {
        const updated = task.clone();
        updated.status = status;
        updated.meta.lastUpdated = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ss.SSSZ'));
        if (statusReason) {
            if (!updated.statusReason) {
                updated.statusReason = {};
            }
            updated.statusReason.text = statusReason;
        }
        await this.writeTaskAsync(updated);
    }

    /**
     * Flips a Task from 'requested' to 'in-progress' the first time any range reports
     * having started. No-op if the Task is already past 'requested'.
     * @param {Object} task
     * @returns {Promise<void>}
     */
    async handleRangeStartedAsync(task) {
        if (task.status !== 'requested') {
            return;
        }
        await this.updateTaskStatusAsync(task, 'in-progress');
    }

    /**
     * Marks a Task 'failed', unless it already reached 'completed' -- a late-arriving or
     * redelivered failure report must not regress an already-completed Task.
     * @param {Object} task
     * @param {string} [errorMessage]
     * @returns {Promise<void>}
     */
    async handleRangeFailedAsync(task, errorMessage) {
        if (task.status === 'completed') {
            return;
        }
        await this.updateTaskStatusAsync(task, 'failed', errorMessage);
    }

    /**
     * Appends this range's result/error S3 URIs to Task.output, then flips the Task to
     * 'completed' once every range of every input file has reported in.
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

        const rangeEntryId = this.buildRangeOutputEntryId({ filepath, rangeIndex });
        const alreadyRecorded = (task.output || []).some((o) =>
            typeof o.id === 'string' && (o.id === rangeEntryId || o.id.startsWith(`${rangeEntryId}-`))
        );
        if (alreadyRecorded) {
            return;
        }

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

        const updated = task.clone();
        updated.output = [...(updated.output || []), ...newOutputs];
        updated.meta.lastUpdated = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ss.SSSZ'));
        await this.writeTaskAsync(updated);

        if (this.countCompletedRanges(updated) >= taskTotalRanges) {
            await this.updateTaskStatusAsync(updated, 'completed');
        }
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
