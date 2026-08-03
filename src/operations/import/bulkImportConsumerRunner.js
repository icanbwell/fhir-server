const moment = require('moment-timezone');
const { assertTypeEquals } = require('../../utils/assertType');
const { ConfigManager } = require('../../utils/configManager');
const { DatabaseQueryFactory } = require('../../dataLayer/databaseQueryFactory');
const { DatabaseUpdateFactory } = require('../../dataLayer/databaseUpdateFactory');
const { FastDatabaseBulkInserter } = require('../../dataLayer/fastDatabaseBulkInserter');
const { S3NdjsonReader } = require('./s3NdjsonReader');
const { FhirResourceWriteSerializer } = require('../../fhir/fhirResourceWriteSerializer');
const { FhirRequestInfo } = require('../../utils/fhirRequestInfo');
const { buildContextDataForHybridStorage } = require('../../utils/contextDataBuilder');
const { generateUUID } = require('../../utils/uid.util');
const { SecurityTagSystem } = require('../../utils/securityTagSystem');
const { BWELL_PERSON_SOURCE_ASSIGNING_AUTHORITY } = require('../../constants');
const { PostRequestProcessor } = require('../../utils/postRequestProcessor');
const { RequestSpecificCache } = require('../../utils/requestSpecificCache');
const { logInfo, logError } = require('../common/logging');

/**
 * Extension URL used to record a marker on the Task each time a byte-range finishes
 * processing. Markers accumulate across concurrent consumer pods/files (Task.output/
 * extension array merges are additive — see resourceMerger's array-union semantics) and
 * are the only way to determine when every range of every input file is done, since no
 * single event carries a task-wide range count (ImportRangeRequested's totalRanges is
 * per-file only).
 * @type {string}
 */
const BULK_IMPORT_RANGE_COMPLETED_EXTENSION_URL = 'https://www.icanbwell.com/bulk-import-range-completed';

class BulkImportConsumerRunner {
    /**
     * @typedef {Object} ConstructorParams
     * @property {ConfigManager} configManager
     * @property {DatabaseQueryFactory} databaseQueryFactory
     * @property {DatabaseUpdateFactory} databaseUpdateFactory
     * @property {FastDatabaseBulkInserter} fastDatabaseBulkInserter
     * @property {S3NdjsonReader} s3NdjsonReader
     * @property {PostRequestProcessor} postRequestProcessor
     * @property {RequestSpecificCache} requestSpecificCache
     *
     * @param {ConstructorParams}
     */
    constructor({
        configManager,
        databaseQueryFactory,
        databaseUpdateFactory,
        fastDatabaseBulkInserter,
        s3NdjsonReader,
        postRequestProcessor,
        requestSpecificCache
    }) {
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);

        this.databaseUpdateFactory = databaseUpdateFactory;
        assertTypeEquals(databaseUpdateFactory, DatabaseUpdateFactory);

        this.fastDatabaseBulkInserter = fastDatabaseBulkInserter;
        assertTypeEquals(fastDatabaseBulkInserter, FastDatabaseBulkInserter);

        this.s3NdjsonReader = s3NdjsonReader;
        assertTypeEquals(s3NdjsonReader, S3NdjsonReader);

        this.postRequestProcessor = postRequestProcessor;
        assertTypeEquals(postRequestProcessor, PostRequestProcessor);

        this.requestSpecificCache = requestSpecificCache;
        assertTypeEquals(requestSpecificCache, RequestSpecificCache);
    }

    /**
     * Builds a request-scoped FhirRequestInfo for a single byte-range's writes.
     * A fresh requestId is required per range so concurrent ranges don't share
     * the singleton FastDatabaseBulkInserter's buffered-operations map.
     * @param {{ user: string|null, scope: string|null }} params
     * @returns {FhirRequestInfo}
     */
    buildRangeRequestInfo({ user, scope }) {
        return new FhirRequestInfo({
            user: user || null,
            scope: scope || null,
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
     * NDJSON lines typically carry no ownership metadata. Stamp the same
     * default owner/sourceAssigningAuthority tags $import's Task creation uses,
     * unless the source file already provided its own security tags.
     * @param {Object} rawResource
     * @returns {Object}
     */
    applyDefaultSecurityTagsIfMissing(rawResource) {
        if (!rawResource.meta) {
            rawResource.meta = {};
        }
        if (!rawResource.meta.security || rawResource.meta.security.length === 0) {
            rawResource.meta.security = [
                { system: SecurityTagSystem.owner, code: BWELL_PERSON_SOURCE_ASSIGNING_AUTHORITY },
                { system: SecurityTagSystem.sourceAssigningAuthority, code: BWELL_PERSON_SOURCE_ASSIGNING_AUTHORITY }
            ];
        }
        if (!rawResource.meta.source) {
            rawResource.meta.source = BWELL_PERSON_SOURCE_ASSIGNING_AUTHORITY;
        }
        return rawResource;
    }

    /**
     * Parses a CloudEvent message from Kafka
     * @param {string} messageValue
     * @returns {Object} parsed CloudEvent data
     */
    parseCloudEvent(messageValue) {
        const envelope = JSON.parse(messageValue);
        if (envelope.type !== 'ImportRangeRequested') {
            throw new Error(`Unexpected event type: ${envelope.type}`);
        }
        if (!envelope.data || !envelope.data.taskId || !envelope.data.filepath) {
            throw new Error('Invalid ImportRangeRequested event: missing taskId or filepath');
        }
        return envelope.data;
    }

    /**
     * Loads the Task resource by ID
     * @param {string} taskId
     * @returns {Promise<Object|null>}
     */
    async loadTaskAsync(taskId) {
        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: 'Task',
            base_version: '4_0_0'
        });

        return databaseQueryManager.findOneAsync({
            query: { id: taskId }
        });
    }

    /**
     * Updates the Task status in MongoDB. Uses replaceOneAsync's optimistic-concurrency
     * merge (not a raw full-document replace) since multiple consumer pods update the
     * same Task concurrently — a raw replace built from a stale snapshot would silently
     * wipe out another pod's already-committed output/extension entries.
     * @param {Object} task
     * @param {string} status
     * @param {string} [statusReason]
     * @param {FhirRequestInfo} requestInfo
     * @returns {Promise<void>}
     */
    async updateTaskStatusAsync(task, status, statusReason, requestInfo) {
        const databaseUpdateManager = this.databaseUpdateFactory.createDatabaseUpdateManager({
            resourceType: 'Task',
            base_version: '4_0_0'
        });

        const updated = task.clone();
        updated.status = status;
        updated.meta.lastUpdated = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ss.SSSZ'));
        if (statusReason) {
            if (!updated.statusReason) {
                updated.statusReason = {};
            }
            updated.statusReason.text = statusReason;
        }

        await databaseUpdateManager.replaceOneAsync({ base_version: '4_0_0', requestInfo, doc: updated });
    }

    /**
     * Splits an S3 key (relative to its bucket) into a result and an error output key
     * for the given range, nesting both under an "output/" prefix alongside the input file.
     * e.g. "run-20260521/Patient.ndjson" + rangeIndex 0 -> "run-20260521/output/Patient-001.ndjson"
     * @param {{ key: string, rangeIndex: number }} params
     * @returns {{ resultKey: string, errorKey: string }}
     */
    buildRangeOutputKeys({ key, rangeIndex }) {
        const lastSlash = key.lastIndexOf('/');
        const dir = lastSlash === -1 ? '' : key.slice(0, lastSlash + 1);
        const filename = lastSlash === -1 ? key : key.slice(lastSlash + 1);
        const base = filename.replace(/\.ndjson$/i, '');
        const suffix = String(rangeIndex + 1).padStart(3, '0');
        return {
            resultKey: `${dir}output/${base}-${suffix}.ndjson`,
            errorKey: `${dir}output/errors/${base}-${suffix}-errors.ndjson`
        };
    }

    /**
     * @param {import('../common/mergeResultEntry').MergeResultEntry[]} entries
     * @returns {string}
     */
    buildNdjson(entries) {
        return entries.map((entry) => JSON.stringify(entry.toJSON())).join('\n') + '\n';
    }

    /**
     * Whether every byte-range of every input file on this Task has recorded a
     * completion marker. Cross-references Task.input (fixed at Task creation) against
     * the completion markers accumulated in Task.extension.
     * @param {Object} task
     * @returns {boolean}
     */
    isTaskFullyComplete(task) {
        const inputUrls = (task.input || []).map((i) => i.valueUri).filter(Boolean);
        if (inputUrls.length === 0) {
            return false;
        }

        const markers = (task.extension || [])
            .filter((e) => e.url === BULK_IMPORT_RANGE_COMPLETED_EXTENSION_URL && e.valueString)
            .map((e) => {
                const [markerFilepath, markerRangeIndex, markerTotalRanges] = e.valueString.split('|');
                return {
                    filepath: markerFilepath,
                    rangeIndex: Number(markerRangeIndex),
                    totalRanges: Number(markerTotalRanges)
                };
            });

        return inputUrls.every((url) => {
            const fileMarkers = markers.filter((m) => m.filepath === url);
            if (fileMarkers.length === 0) {
                return false;
            }
            const distinctRanges = new Set(fileMarkers.map((m) => m.rangeIndex));
            return distinctRanges.size === fileMarkers[0].totalRanges;
        });
    }

    /**
     * Writes this range's merge-result (and error, if any) NDJSON to S3, appends
     * Task.output entries pointing at them, and records a completion marker so
     * isTaskFullyComplete() can detect when every range of every file is done.
     * Best-effort: a failure here is logged but does not fail the range — the
     * underlying MongoDB writes already succeeded by this point.
     * @param {Object} params
     * @param {Object} params.task
     * @param {string} params.taskId
     * @param {string} params.filepath
     * @param {number} params.rangeIndex
     * @param {number} params.totalRanges
     * @param {import('../common/mergeResultEntry').MergeResultEntry[]} params.mergeResultEntries
     * @param {FhirRequestInfo} params.requestInfo
     * @returns {Promise<void>}
     */
    async recordRangeCompletionAsync({ taskId, filepath, rangeIndex, totalRanges, mergeResultEntries, requestInfo }) {
        try {
            // Reload fresh rather than reusing the Task loaded at the top of handleMessageAsync —
            // that snapshot can be minutes stale by the time a large range finishes, and
            // replaceOneAsync's merge takes scalar fields (e.g. status) from OUR doc when they
            // differ from the DB, so a stale snapshot here could silently regress a concurrent
            // status change.
            const task = await this.loadTaskAsync(taskId);
            if (!task) {
                logError('Task disappeared before range completion could be recorded', { taskId, filepath, rangeIndex });
                return;
            }

            const { bucket, key } = this.s3NdjsonReader.parseS3Uri(filepath);
            const { resultKey, errorKey } = this.buildRangeOutputKeys({ key, rangeIndex });

            const newOutputs = [];
            if (mergeResultEntries.length > 0) {
                const resultUri = `s3://${bucket}/${resultKey}`;
                await this.s3NdjsonReader.writeNdjsonAsync({
                    filepath: resultUri,
                    data: this.buildNdjson(mergeResultEntries)
                });
                newOutputs.push({ type: { text: 'result' }, valueUri: resultUri });
            }

            const failedEntries = mergeResultEntries.filter((entry) => entry.operationOutcome);
            if (failedEntries.length > 0) {
                const errorUri = `s3://${bucket}/${errorKey}`;
                await this.s3NdjsonReader.writeNdjsonAsync({
                    filepath: errorUri,
                    data: this.buildNdjson(failedEntries)
                });
                newOutputs.push({ type: { text: 'error' }, valueUri: errorUri });
            }

            const updated = task.clone();
            updated.output = [...(updated.output || []), ...newOutputs];
            updated.extension = [
                ...(updated.extension || []),
                {
                    url: BULK_IMPORT_RANGE_COMPLETED_EXTENSION_URL,
                    valueString: `${filepath}|${rangeIndex}|${totalRanges}`
                }
            ];

            const databaseUpdateManager = this.databaseUpdateFactory.createDatabaseUpdateManager({
                resourceType: 'Task',
                base_version: '4_0_0'
            });
            const { savedResource } = await databaseUpdateManager.replaceOneAsync({
                base_version: '4_0_0',
                requestInfo,
                doc: updated
            });

            // A null savedResource means the merge detected no change (e.g. a Kafka
            // redelivery of a range already recorded) — re-read to see current state.
            const finalTask = savedResource || await this.loadTaskAsync(taskId);
            if (finalTask && finalTask.status !== 'completed' && this.isTaskFullyComplete(finalTask)) {
                await this.updateTaskStatusAsync(finalTask, 'completed', undefined, requestInfo);
            }
        } catch (e) {
            logError('Failed to record bulk import range completion', {
                taskId,
                filepath,
                rangeIndex,
                error: e.message
            });
        }
    }

    /**
     * Handles a single Kafka message (ImportRangeRequested)
     * @param {{ key: string, value: string, headers: Array<{key: string, value: string}> }} message
     * @returns {Promise<void>}
     */
    async handleMessageAsync(message) {
        let eventData;
        try {
            eventData = this.parseCloudEvent(message.value);
        } catch (e) {
            logError('Failed to parse bulk import Kafka message', {
                error: e.message,
                key: message.key
            });
            return;
        }

        const { taskId, filepath, byteRangeStart, byteRangeEnd, rangeIndex, totalRanges, fileSize, user, scope } = eventData;

        logInfo('Processing bulk import range', {
            taskId,
            filepath,
            byteRangeStart,
            byteRangeEnd,
            rangeIndex,
            totalRanges
        });

        const task = await this.loadTaskAsync(taskId);
        if (!task) {
            logError('Task not found for bulk import message', { taskId });
            return;
        }

        const requestInfo = this.buildRangeRequestInfo({ user, scope });

        if (task.status === 'requested') {
            await this.updateTaskStatusAsync(task, 'in-progress', undefined, requestInfo);
        }

        const base_version = '4_0_0';
        const batchSize = this.configManager.bulkImportBatchSize;
        const batchDelayMs = this.configManager.bulkImportBatchDelayMs;

        let linesRead = 0;
        let sinceLastFlush = 0;
        let created = 0;
        let updated = 0;
        let failed = 0;
        const mergeResultEntries = [];

        const flushBatchAsync = async () => {
            const mergeResults = await this.fastDatabaseBulkInserter.executeAsync({ requestInfo, base_version });
            for (const mergeResult of mergeResults) {
                mergeResultEntries.push(mergeResult);
                if (mergeResult.created) {
                    created++;
                } else if (mergeResult.updated) {
                    updated++;
                } else if (mergeResult.operationOutcome) {
                    failed++;
                }
            }
            sinceLastFlush = 0;
        };

        try {
            try {
                for await (const { lineNumber, resource } of this.s3NdjsonReader.readNdjsonAsync({
                    filepath,
                    byteRangeStart,
                    byteRangeEnd,
                    fileSize
                })) {
                    linesRead++;
                    sinceLastFlush++;

                    try {
                        const fhirResource = FhirResourceWriteSerializer.serialize({
                            obj: this.applyDefaultSecurityTagsIfMissing(resource)
                        });
                        const contextData = buildContextDataForHybridStorage(
                            fhirResource.resourceType, fhirResource, requestInfo
                        );
                        await this.fastDatabaseBulkInserter.insertOneAsync({
                            base_version,
                            requestInfo,
                            resourceType: fhirResource.resourceType,
                            doc: fhirResource,
                            contextData
                        });
                    } catch (resourceError) {
                        failed++;
                        logError('Failed to buffer bulk import resource for write', {
                            taskId,
                            filepath,
                            lineNumber,
                            error: resourceError.message
                        });
                    }

                    if (sinceLastFlush >= batchSize) {
                        await flushBatchAsync();
                        // Rate control: yield between batches so a single range doesn't
                        // monopolize the event loop or MongoDB's write capacity.
                        await new Promise((resolve) => setTimeout(resolve, batchDelayMs));
                    }
                }
                if (sinceLastFlush > 0) {
                    await flushBatchAsync();
                }
            } catch (e) {
                logError('Error reading S3 NDJSON range', {
                    taskId,
                    filepath,
                    rangeIndex,
                    error: e.message
                });
                await this.updateTaskStatusAsync(task, 'failed', e.message, requestInfo);
                return;
            }

            logInfo('Bulk import range processed', {
                taskId,
                filepath,
                rangeIndex,
                totalRanges,
                linesRead,
                created,
                updated,
                failed
            });

            await this.recordRangeCompletionAsync({
                taskId,
                filepath,
                rangeIndex,
                totalRanges,
                mergeResultEntries,
                requestInfo
            });
        } finally {
            // FastDatabaseBulkInserter defers history writes onto postRequestProcessor's
            // queue rather than writing them inline — without this, history writes for
            // every bulk-imported resource would be silently dropped. RequestSpecificCache
            // entries are also only ever freed by an explicit clearAsync, so skipping this
            // would leak one entry per Kafka message in this long-running consumer.
            await this.postRequestProcessor.executeAsync({ requestId: requestInfo.requestId });
            await this.requestSpecificCache.clearAsync({ requestId: requestInfo.requestId });
        }
    }
}

module.exports = { BulkImportConsumerRunner };
