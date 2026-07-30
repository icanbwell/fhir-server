const moment = require('moment-timezone');
const { assertTypeEquals } = require('../../utils/assertType');
const { ConfigManager } = require('../../utils/configManager');
const { DatabaseQueryFactory } = require('../../dataLayer/databaseQueryFactory');
const { DatabaseUpdateFactory } = require('../../dataLayer/databaseUpdateFactory');
const { FastDatabaseBulkInserter } = require('../../dataLayer/fastDatabaseBulkInserter');
const { S3NdjsonReader } = require('./s3NdjsonReader');
const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');
const { FhirRequestInfo } = require('../../utils/fhirRequestInfo');
const { buildContextDataForHybridStorage } = require('../../utils/contextDataBuilder');
const { generateUUID } = require('../../utils/uid.util');
const { SecurityTagSystem } = require('../../utils/securityTagSystem');
const { BWELL_PERSON_SOURCE_ASSIGNING_AUTHORITY } = require('../../constants');
const { PostRequestProcessor } = require('../../utils/postRequestProcessor');
const { RequestSpecificCache } = require('../../utils/requestSpecificCache');
const { logInfo, logError } = require('../common/logging');

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
     * Updates the Task status in MongoDB
     * @param {Object} task
     * @param {string} status
     * @param {string} [statusReason]
     * @returns {Promise<void>}
     */
    async updateTaskStatusAsync(task, status, statusReason) {
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

        await databaseUpdateManager.updateOneAsync({ doc: updated });
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

        if (task.status === 'requested') {
            await this.updateTaskStatusAsync(task, 'in-progress');
        }

        const base_version = '4_0_0';
        const requestInfo = this.buildRangeRequestInfo({ user, scope });
        const batchSize = this.configManager.bulkImportBatchSize;
        const batchDelayMs = this.configManager.bulkImportBatchDelayMs;

        let linesRead = 0;
        let sinceLastFlush = 0;
        let created = 0;
        let updated = 0;
        let failed = 0;

        const flushBatchAsync = async () => {
            const mergeResults = await this.fastDatabaseBulkInserter.executeAsync({ requestInfo, base_version });
            for (const mergeResult of mergeResults) {
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
                        const fhirResource = FhirResourceCreator.create(
                            this.applyDefaultSecurityTagsIfMissing(resource)
                        );
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
                await this.updateTaskStatusAsync(task, 'failed', e.message);
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
