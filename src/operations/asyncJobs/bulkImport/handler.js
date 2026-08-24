const { S3Client: S3, HeadObjectCommand } = require('@aws-sdk/client-s3');
const querystring = require('querystring');
const moment = require('moment-timezone');
const { assertTypeEquals } = require('../../../utils/assertType');
const { ConfigManager } = require('../../../utils/configManager');
const { KafkaClientV2 } = require('../../../utils/kafkaClientV2');
const { DatabaseQueryFactory } = require('../../../dataLayer/databaseQueryFactory');
const { FastDatabaseBulkInserter } = require('../../../dataLayer/fastDatabaseBulkInserter');
const { S3NdjsonReader } = require('./s3NdjsonReader');
const { BulkImportEventProducer } = require('./bulkImportEventProducer');
const { BulkImportTaskStateMachine } = require('./bulkImportTaskStateMachine');
const { FhirResourceWriteSerializer } = require('../../../fhir/fhirResourceWriteSerializer');
const { FhirRequestInfo } = require('../../../utils/fhirRequestInfo');
const { generateUUID, isUuid } = require('../../../utils/uid.util');
const { MergeManager } = require('../../merge/mergeManager');
const { DatabaseBulkLoader } = require('../../../dataLayer/databaseBulkLoader');
const { SourceAssigningAuthorityColumnHandler } = require('../../../preSaveHandlers/handlers/sourceAssigningAuthorityColumnHandler');
const { UuidColumnHandler } = require('../../../preSaveHandlers/handlers/uuidColumnHandler');
const { WriteAllowedByScopesValidator } = require('../../merge/validators/writeAllowedByScopesValidator');
const { SecurityTagSystem } = require('../../../utils/securityTagSystem');
const { BWELL_PERSON_SOURCE_ASSIGNING_AUTHORITY, STRICT_SEARCH_HANDLING } = require('../../../constants');
const { PostRequestProcessor } = require('../../../utils/postRequestProcessor');
const { RequestSpecificCache } = require('../../../utils/requestSpecificCache');
const { trace } = require('@opentelemetry/api');
const { MergeResultEntry } = require('../../common/mergeResultEntry');
const { logInfo, logError } = require('../../common/logging');
const {
    recordImportOperationTriggered,
    recordImportFileSize,
    recordImportResourceOutcomes,
    recordImportRangeDuration
} = require('../../../utils/metrics');
const { retryWithBackoff } = require('../../../utils/retryWithBackoff');
const { AuditLogger } = require('../../../utils/auditLogger');
const { groupByLambda } = require('../../../utils/list.util');
const { R4ArgsParser } = require('../../query/r4ArgsParser');
const { SearchQueryBuilder } = require('../../search/searchQueryBuilder');

const importTracer = trace.getTracer('fhir-server');


/**
 * Attaches bulk-import outcome data as span attributes rather than a custom OTel counter --
 * with trace context propagated across both Kafka hops, an external observability platform
 * can group spans by trace ID itself and alert on cross-span ratios (e.g. failed /
 * (created + updated + failed) per trace) without any app-side aggregation or a hardcoded
 * threshold in this codebase. Falls back to a short-lived span of our own when nothing is
 * active (e.g. auto-instrumentation not loaded in this environment), so the data isn't
 * silently dropped.
 * @param {Object} attributes
 */
function recordImportSpanAttributes (attributes) {
    const activeSpan = trace.getActiveSpan();
    if (activeSpan) {
        activeSpan.setAttributes(attributes);
        return;
    }
    const span = importTracer.startSpan('bulk_import.outcome');
    span.setAttributes(attributes);
    span.end();
}

/**
 * Handles every Kafka message type for the bulk-import async job. Both
 * src/operations/asyncJobs/orchestrator.js (topics fhir_server.bulk_import.requested and
 * fhir_server.bulk_import.range_progress) and src/operations/asyncJobs/worker.js (topic
 * fhir_server.bulk_import.events) route into this same handler; handleMessageAsync dispatches
 * on the CloudEvent "type" rather than the topic, since a single job's messages can arrive on
 * more than one topic:
 * - TaskCreated (orchestrator): HEADs each S3 input to validate it and get its size, splits
 *   it into byte ranges, and publishes an ImportRangeRequested event per range.
 * - ImportRangeRequested (worker): reads a byte range's NDJSON and merges resources, then
 *   reports what happened by publishing ImportRangeStarted/ImportRangeCompleted/
 *   ImportRangeFailed rather than writing to the Task itself.
 * - ImportRangeStarted/ImportRangeCompleted/ImportRangeFailed (orchestrator): the ONLY writes
 *   to a Task resource once it exists happen here. Routing every worker report through the
 *   orchestrator's single consumer means there is exactly one writer for a given Task's
 *   status/output at any time -- no concurrent-update races between worker pods to resolve,
 *   and no need for smartMerge array-matching tricks on Task.output/extension.
 */
class BulkImportHandler {
    /**
     * @typedef {Object} ConstructorParams
     * @property {ConfigManager} configManager
     * @property {KafkaClientV2} kafkaClientV2
     * @property {BulkImportEventProducer} bulkImportEventProducer
     * @property {BulkImportTaskStateMachine} bulkImportTaskStateMachine
     * @property {DatabaseQueryFactory} databaseQueryFactory
     * @property {FastDatabaseBulkInserter} fastDatabaseBulkInserter
     * @property {S3NdjsonReader} s3NdjsonReader
     * @property {PostRequestProcessor} postRequestProcessor
     * @property {RequestSpecificCache} requestSpecificCache
     * @property {AuditLogger} auditLogger
     * @property {R4ArgsParser} r4ArgsParser
     * @property {SearchQueryBuilder} searchQueryBuilder
     * @property {MergeManager} mergeManager
     * @property {DatabaseBulkLoader} databaseBulkLoader
     * @property {SourceAssigningAuthorityColumnHandler} sourceAssigningAuthorityColumnHandler
     * @property {UuidColumnHandler} uuidColumnHandler
     * @property {WriteAllowedByScopesValidator} writeAllowedByScopesValidator
     *
     * @param {ConstructorParams}
     */
    constructor({
        configManager,
        kafkaClientV2,
        bulkImportEventProducer,
        bulkImportTaskStateMachine,
        databaseQueryFactory,
        fastDatabaseBulkInserter,
        s3NdjsonReader,
        postRequestProcessor,
        requestSpecificCache,
        auditLogger,
        r4ArgsParser,
        searchQueryBuilder,
        mergeManager,
        databaseBulkLoader,
        sourceAssigningAuthorityColumnHandler,
        uuidColumnHandler,
        writeAllowedByScopesValidator
    }) {
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        this.kafkaClientV2 = kafkaClientV2;
        assertTypeEquals(kafkaClientV2, KafkaClientV2);

        this.bulkImportEventProducer = bulkImportEventProducer;
        assertTypeEquals(bulkImportEventProducer, BulkImportEventProducer);

        this.bulkImportTaskStateMachine = bulkImportTaskStateMachine;
        assertTypeEquals(bulkImportTaskStateMachine, BulkImportTaskStateMachine);

        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);

        this.fastDatabaseBulkInserter = fastDatabaseBulkInserter;
        assertTypeEquals(fastDatabaseBulkInserter, FastDatabaseBulkInserter);

        this.s3NdjsonReader = s3NdjsonReader;
        assertTypeEquals(s3NdjsonReader, S3NdjsonReader);

        this.postRequestProcessor = postRequestProcessor;
        assertTypeEquals(postRequestProcessor, PostRequestProcessor);

        this.requestSpecificCache = requestSpecificCache;
        assertTypeEquals(requestSpecificCache, RequestSpecificCache);

        this.auditLogger = auditLogger;
        assertTypeEquals(auditLogger, AuditLogger);

        this.r4ArgsParser = r4ArgsParser;
        assertTypeEquals(r4ArgsParser, R4ArgsParser);

        this.searchQueryBuilder = searchQueryBuilder;
        assertTypeEquals(searchQueryBuilder, SearchQueryBuilder);

        this.mergeManager = mergeManager;
        assertTypeEquals(mergeManager, MergeManager);

        this.databaseBulkLoader = databaseBulkLoader;
        assertTypeEquals(databaseBulkLoader, DatabaseBulkLoader);

        this.sourceAssigningAuthorityColumnHandler = sourceAssigningAuthorityColumnHandler;
        assertTypeEquals(sourceAssigningAuthorityColumnHandler, SourceAssigningAuthorityColumnHandler);

        this.uuidColumnHandler = uuidColumnHandler;
        assertTypeEquals(uuidColumnHandler, UuidColumnHandler);

        this.writeAllowedByScopesValidator = writeAllowedByScopesValidator;
        assertTypeEquals(writeAllowedByScopesValidator, WriteAllowedByScopesValidator);
    }

    /**
     * Routes a raw Kafka message to the handler for its CloudEvent type.
     * @param {{ key: string, value: string, headers: Array<{key: string, value: string}> }} message
     * @returns {Promise<void>}
     */
    async handleMessageAsync(message) {
        let envelope;
        try {
            envelope = JSON.parse(message.value);
        } catch (e) {
            logError('Failed to parse bulk import Kafka message', {
                error: e.message,
                key: message.key
            });
            return;
        }

        switch (envelope.type) {
            case 'TaskCreated':
                return this.handleTaskCreatedAsync(message);
            case 'ImportRangeRequested':
                return this.handleImportRangeRequestedAsync(message);
            case 'ImportRangeStarted':
            case 'ImportRangeCompleted':
            case 'ImportRangeFailed':
                return this.handleRangeProgressEventAsync(message, envelope.type);
            default:
                logError('Unexpected bulk import event type', { type: envelope.type, key: message.key });
        }
    }

    /**
     * Loads a bulk-import Task by id. Delegates to BulkImportTaskStateMachine.
     * @param {string} taskId
     * @returns {Promise<Object|null>}
     */
    async loadTaskAsync(taskId) {
        return this.bulkImportTaskStateMachine.loadTaskAsync(taskId);
    }

    /**
     * Checks whether a resource matching an `ifNoneExist` search query already exists, for
     * the `{ ifNoneExist, resource }` NDJSON line wrapper's conditional-create semantics.
     * Bypasses SearchManager's user-scope filtering (bulk import runs as a service principal,
     * not a scoped user search) but still restricts the match to the importing resource's own
     * owner tenant -- otherwise this existence check would be a cross-tenant oracle: a match
     * belonging to a different tenant would silently suppress this tenant's create and leak
     * that a same-identifier resource exists elsewhere.
     *
     * Requires a resolved ownerCode and parses with strict search-parameter handling: an
     * unrecognized/mistyped query parameter (e.g. "identifer=...") would otherwise silently
     * drop out of the filter entirely, collapsing the query to "any resource of this type
     * owned by this tenant" -- a fail-open match that would wrongly skip the create.
     * @param {Object} params
     * @param {string} params.resourceType
     * @param {string} params.ifNoneExist - a FHIR search-query string, e.g.
     *   "identifier=http://example.com|12345", the same format as the If-None-Exist header.
     * @param {string} params.ownerCode - the owner-tag code from the importing resource's own
     *   meta.security; the existence check is restricted to resources owned by this tenant.
     * @returns {Promise<Object|null>}
     */
    async findExistingResourceForIfNoneExistAsync({ resourceType, ifNoneExist, ownerCode }) {
        if (!ifNoneExist || !ifNoneExist.trim()) {
            throw new Error('ifNoneExist is empty');
        }
        if (!ownerCode) {
            throw new Error('Cannot resolve an owner tag to scope the ifNoneExist existence check');
        }

        const base_version = '4_0_0';
        const args = querystring.parse(ifNoneExist);
        args.base_version = base_version;
        // Strict handling: an unrecognized search parameter must throw rather than silently
        // no-op out of the query (see class docstring above).
        args.handling = STRICT_SEARCH_HANDLING;
        const parsedArgs = this.r4ArgsParser.parseArgs({ resourceType, args });
        const { query } = this.searchQueryBuilder.buildSearchQueryBasedOnVersion({
            base_version,
            parsedArgs,
            resourceType,
            operation: 'read'
        });

        const scopedQuery = {
            $and: [
                query,
                {
                    'meta.security': {
                        $elemMatch: { system: SecurityTagSystem.owner, code: ownerCode }
                    }
                }
            ]
        };

        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType,
            base_version
        });
        return databaseQueryManager.findOneAsync({ query: scopedQuery });
    }

    // ── TaskCreated (orchestrator side, topic fhir_server.bulk_import.requested) ───────────

    /**
     * Parses a TaskCreated CloudEvent message
     * @param {string} messageValue
     * @returns {Object} parsed CloudEvent data
     */
    parseTaskCreatedEvent(messageValue) {
        const envelope = JSON.parse(messageValue);
        if (envelope.type !== 'TaskCreated') {
            throw new Error(`Unexpected event type: ${envelope.type}`);
        }
        if (!envelope.data || !envelope.data.taskId) {
            throw new Error('Invalid TaskCreated event: missing taskId');
        }
        return envelope.data;
    }

    /**
     * Updates a Task's status. Delegates to BulkImportTaskStateMachine.
     * @param {Object} task
     * @param {string} status
     * @param {string} [statusReason]
     * @returns {Promise<void>}
     */
    async updateOrchestratorTaskStatusAsync(task, status, statusReason) {
        return this.bulkImportTaskStateMachine.updateTaskStatusAsync(task, status, statusReason);
    }

    /**
     * HEADs each S3 file to get file sizes and validate they exist.
     * Validates each bucket against the configured allow-list to prevent SSRF.
     * @param {Array<{ url: string }>} inputs
     * @returns {Promise<Array<{ url: string, fileSize: number }>>}
     */
    async headS3FilesAsync(inputs) {
        const allowedBuckets = this.configManager.bulkImportAllowedS3Buckets;
        if (!allowedBuckets.length) {
            throw new Error('Bulk import S3 bucket allowlist is not configured');
        }

        const region = this.configManager.awsRegion || 'us-east-1';
        const s3 = new S3({ region });
        const minBytes = this.configManager.bulkImportMinFileSizeMb * 1024 * 1024;
        const maxBytes = this.configManager.bulkImportMaxFileSizeGb * 1024 * 1024 * 1024;

        const results = [];
        for (const input of inputs) {
            const match = input.url.match(/^s3:\/\/([^/]+)\/(.+)$/);
            if (!match) {
                throw new Error(`Invalid S3 URI: "${input.url}"`);
            }
            const bucket = match[1];
            const key = match[2];

            if (!allowedBuckets.includes(bucket)) {
                throw new Error(`S3 bucket "${bucket}" is not in the allowed list`);
            }

            let fileSize;
            try {
                const response = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
                fileSize = response.ContentLength;
            } catch (e) {
                throw new Error(`Cannot access S3 file "${input.url}": ${e.name}: ${e.message}`);
            }

            if (!Number.isFinite(fileSize)) {
                throw new Error(`S3 HEAD for "${input.url}" returned no ContentLength`);
            }

            if (fileSize <= 0) {
                throw new Error(`File "${input.url}" is empty (0 bytes)`);
            }
            if (minBytes > 0 && fileSize < minBytes) {
                throw new Error(
                    `File "${input.url}" is ${(fileSize / (1024 * 1024)).toFixed(1)} MB, ` +
                    `below the minimum of ${this.configManager.bulkImportMinFileSizeMb} MB`
                );
            }
            if (fileSize > maxBytes) {
                throw new Error(
                    `File "${input.url}" is ${(fileSize / (1024 * 1024 * 1024)).toFixed(1)} GB, ` +
                    `above the maximum of ${this.configManager.bulkImportMaxFileSizeGb} GB`
                );
            }

            recordImportFileSize(fileSize);
            results.push({ url: input.url, fileSize });
        }
        return results;
    }

    /**
     * Handles a single TaskCreated Kafka message:
     * HEADs S3 files for sizes, then publishes byte-range messages
     * @param {{ key: string, value: string, headers: Array<{key: string, value: string}> }} message
     * @returns {Promise<void>}
     */
    async handleTaskCreatedAsync(message) {
        let eventData;
        try {
            eventData = this.parseTaskCreatedEvent(message.value);
        } catch (e) {
            logError('Failed to parse TaskCreated Kafka message', {
                error: e.message,
                key: message.key
            });
            return;
        }

        const { taskId, inputs, requestId, scope, user, alternateUserId, isUser, remoteIpAddress } = eventData;

        logInfo('Orchestrator received TaskCreated event', {
            taskId,
            inputCount: inputs.length,
            inputs,
            requestId,
            scope,
            user
        });

        const task = await this.loadTaskAsync(taskId);
        if (!task) {
            logError('Task not found for orchestrator message', { taskId });
            return;
        }

        recordImportOperationTriggered();

        let inputsWithSizes;
        try {
            inputsWithSizes = await this.headS3FilesAsync(inputs);
        } catch (e) {
            logError('S3 validation failed for import task', { taskId, error: e.message });
            await this.updateOrchestratorTaskStatusAsync(task, 'failed', e.message);
            recordImportSpanAttributes({ 'fhir_import.outcome': 'failed' });
            return;
        }

        const messageCount = await this.bulkImportEventProducer.publishImportEventsAsync({
            taskId,
            inputs: inputsWithSizes,
            requestId,
            scope,
            user,
            alternateUserId,
            isUser,
            remoteIpAddress
        });

        logInfo('Orchestrator published byte-range messages', {
            taskId,
            messageCount
        });
    }

    // ── ImportRangeStarted/ImportRangeCompleted/ImportRangeFailed (orchestrator side, ──────
    // ── topic fhir_server.bulk_import.range_progress) ──────────────────────────────────────

    /**
     * Parses an ImportRangeStarted/ImportRangeCompleted/ImportRangeFailed CloudEvent message.
     * @param {string} messageValue
     * @returns {Object} parsed CloudEvent data
     */
    parseRangeProgressEvent(messageValue) {
        const envelope = JSON.parse(messageValue);
        if (!envelope.data || !envelope.data.taskId || !envelope.data.filepath) {
            throw new Error(`Invalid ${envelope.type} event: missing taskId or filepath`);
        }
        return envelope.data;
    }

    /**
     * Handles a range-progress report from a worker. This is the ONLY place a Task resource
     * is ever written once it exists (see class docstring) -- workers only publish these
     * events, they never touch the Task themselves, so there is exactly one writer and no
     * concurrent-update race between worker pods to resolve.
     * @param {{ key: string, value: string, headers: Array<{key: string, value: string}> }} message
     * @param {'ImportRangeStarted'|'ImportRangeCompleted'|'ImportRangeFailed'} type
     * @returns {Promise<void>}
     */
    async handleRangeProgressEventAsync(message, type) {
        let eventData;
        try {
            eventData = this.parseRangeProgressEvent(message.value);
        } catch (e) {
            logError('Failed to parse bulk import range-progress Kafka message', {
                error: e.message,
                key: message.key
            });
            return;
        }

        const { taskId, filepath, rangeIndex } = eventData;

        const task = await this.loadTaskAsync(taskId);
        if (!task) {
            logError('Task not found for bulk import range-progress message', { taskId, filepath, rangeIndex });
            return;
        }

        switch (type) {
            case 'ImportRangeStarted':
                return this.bulkImportTaskStateMachine.handleRangeStartedAsync(task);
            case 'ImportRangeCompleted':
                return this.bulkImportTaskStateMachine.handleRangeCompletedAsync(task, eventData);
            case 'ImportRangeFailed':
                return this.bulkImportTaskStateMachine.handleRangeFailedAsync(task, eventData.errorMessage);
        }
    }

    // ── ImportRangeRequested (worker side, topic fhir_server.bulk_import.events) ───────────

    /**
     * Builds a request-scoped FhirRequestInfo for a single byte-range's writes.
     * A fresh requestId is required per range so concurrent ranges don't share
     * the singleton FastDatabaseBulkInserter's buffered-operations map.
     * @param {{ user: string|null, scope: string|null, alternateUserId: string|undefined,
     *   isUser: boolean|undefined, remoteIpAddress: string|undefined }} params
     * @returns {FhirRequestInfo}
     */
    buildRangeRequestInfo({ user, scope, alternateUserId, isUser, remoteIpAddress }) {
        return new FhirRequestInfo({
            user: user || null,
            scope: scope || null,
            remoteIpAddress: remoteIpAddress || null,
            requestId: generateUUID(),
            userRequestId: null,
            protocol: 'kafka',
            originalUrl: '$import',
            path: '$import',
            host: null,
            body: null,
            accept: 'application/fhir+json',
            isUser: Boolean(isUser),
            userType: null,
            personIdFromJwtToken: null,
            masterPersonIdFromJwtToken: null,
            managingOrganizationId: null,
            headers: {},
            method: 'POST',
            contentTypeFromHeader: null,
            alternateUserId: alternateUserId || null,
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
     * Parses an ImportRangeRequested CloudEvent message
     * @param {string} messageValue
     * @returns {Object} parsed CloudEvent data
     */
    parseImportRangeRequestedEvent(messageValue) {
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
     * @param {import('../../common/mergeResultEntry').MergeResultEntry[]} entries
     * @returns {string}
     */
    buildNdjson(entries) {
        return entries.map((entry) => JSON.stringify(entry.toJSON())).join('\n') + '\n';
    }

    /**
     * Writes NDJSON to S3 with bounded retries — transient throttling/network errors
     * must not permanently block a range from ever recording its completion marker.
     * @param {Object} params
     * @param {string} params.filepath
     * @param {string} params.data
     * @param {number} [params.attempts]
     * @returns {Promise<void>}
     */
    async writeNdjsonWithRetryAsync({ filepath, data, attempts = 3 }) {
        try {
            return await retryWithBackoff({
                fn: () => this.s3NdjsonReader.writeNdjsonAsync({ filepath, data }),
                maxRetries: attempts - 1,
                initialDelayMs: 200,
                onRetry: ({ attempt, error }) => {
                    logError('S3 NDJSON write attempt failed', { filepath, attempt, attempts, error: error.message });
                }
            });
        } catch (e) {
            logError('S3 NDJSON write attempt failed', { filepath, attempt: attempts, attempts, error: e.message });
            throw e;
        }
    }

    /**
     * Retries reading+processing an entire byte range on transient S3/stream failures,
     * but ONLY when nothing has been durably written yet in this attempt (readAndProcess
     * marks a thrown error with `bulkImportRangePartiallyFlushed` once at least one batch
     * has been flushed). This is NOT a generic retryWithBackoff use -- once a batch has
     * flushed, redoing the whole range is unsafe for two independent reasons, so retrying
     * must stop there rather than continue for `attempts` total tries:
     *   1. Not every resourceType's flush is an idempotent Mongo upsert. A resourceType
     *      routed to ClickHouseBulkWriteExecutor (SYNC_DIRECT) or
     *      KafkaClickPipeBulkWriteExecutor (KAFKA_CLICKPIPE) -- e.g. AuditEvent under
     *      enableAuditEventClickPipe/clickHouseOnlyResources -- does an unconditional
     *      insert/produce with no dedup, so replaying an already-flushed batch creates a
     *      duplicate ClickHouse row or Kafka message.
     *   2. Clearing requestId's cache to avoid double-buffering (see below) would also
     *      discard any Kafka change-event/history-write tasks a successful flush already
     *      queued onto postRequestProcessor (it shares the same requestId-keyed cache) --
     *      and re-inserting the same unchanged document on retry gets silently skipped by
     *      mongoBulkWriteExecutor, so that task never gets queued a second time either.
     * Before a safe (pre-first-flush) retry, this clears requestId's buffered-but-unflushed
     * inserts so a failed attempt's partial buffer doesn't get double-inserted alongside
     * the retry's own -- safe here specifically because nothing has flushed yet.
     * Also skips retrying deterministic errors (S3NdjsonReader marks bad input/config --
     * invalid byteRange, oversized line, malformed JSON -- with `retryable = false`) since
     * they fail identically on every attempt.
     * @param {Object} params
     * @param {() => Promise<void>} params.fn
     * @param {string} params.requestId
     * @param {number} [params.attempts]
     * @returns {Promise<void>}
     */
    async readRangeWithRetryAsync({ fn, requestId, attempts = 3 }) {
        let lastError;
        for (let attempt = 1; attempt <= attempts; attempt++) {
            try {
                await fn();
                return;
            } catch (e) {
                lastError = e;
                logError('S3 NDJSON range read attempt failed', {
                    requestId,
                    attempt,
                    attempts,
                    partiallyFlushed: !!e.bulkImportRangePartiallyFlushed,
                    retryable: e.retryable !== false,
                    error: e.message
                });
                if (e.bulkImportRangePartiallyFlushed || e.retryable === false) {
                    throw e;
                }
                if (attempt < attempts) {
                    await this.requestSpecificCache.clearAsync({ requestId });
                    await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
                }
            }
        }
        throw lastError;
    }

    /**
     * Writes this range's merge-result (and error, if any) NDJSON to S3, then reports the
     * range as complete by publishing ImportRangeCompleted -- this worker never writes to the
     * Task itself; the orchestrator (the sole Task writer) appends the resulting S3 URIs to
     * Task.output and decides when every range has reported in. Throws (after S3 write
     * retries) rather than swallowing failures — the caller must let this propagate so an
     * unacknowledged Kafka message gets redelivered instead of a range silently never
     * reporting completion (which would permanently block the Task from ever reaching
     * 'completed'). Redelivery is safe: both the underlying MongoDB writes and the
     * orchestrator's own output-recording are idempotent.
     * @param {Object} params
     * @param {string} params.taskId
     * @param {string} params.filepath
     * @param {number} params.rangeIndex
     * @param {number} params.taskTotalRanges
     * @param {import('../../common/mergeResultEntry').MergeResultEntry[]} params.mergeResultEntries
     * @returns {Promise<void>}
     */
    async reportRangeCompletedAsync({ taskId, filepath, rangeIndex, taskTotalRanges, mergeResultEntries }) {
        const { bucket, key } = this.s3NdjsonReader.parseS3Uri(filepath);
        const { resultKey, errorKey } = this.buildRangeOutputKeys({ key, rangeIndex });

        // Entries land here in commit order, not source order -- an error is recorded the
        // instant its line is read, but a success only once its whole batch flushes, so a
        // later-flushing batch's successes can end up after an earlier error in the array.
        // Restore source order before writing output so position always matches the input file.
        mergeResultEntries.sort((a, b) => (a.sourceByteOffset ?? 0) - (b.sourceByteOffset ?? 0));

        let resultUri = null;
        if (mergeResultEntries.length > 0) {
            resultUri = `s3://${bucket}/${resultKey}`;
            await this.writeNdjsonWithRetryAsync({
                filepath: resultUri,
                data: this.buildNdjson(mergeResultEntries)
            });
        }

        let errorUri = null;
        const failedEntries = mergeResultEntries.filter((entry) => entry.operationOutcome);
        if (failedEntries.length > 0) {
            errorUri = `s3://${bucket}/${errorKey}`;
            await this.writeNdjsonWithRetryAsync({
                filepath: errorUri,
                data: this.buildNdjson(failedEntries)
            });
        }

        await this.bulkImportEventProducer.publishRangeProgressEventAsync({
            type: 'ImportRangeCompleted',
            data: { taskId, filepath, rangeIndex, taskTotalRanges, resultUri, errorUri }
        });
    }

    /**
     * Handles a single Kafka message (ImportRangeRequested)
     * @param {{ key: string, value: string, headers: Array<{key: string, value: string}> }} message
     * @returns {Promise<void>}
     */
    async handleImportRangeRequestedAsync(message) {
        let eventData;
        try {
            eventData = this.parseImportRangeRequestedEvent(message.value);
        } catch (e) {
            logError('Failed to parse bulk import Kafka message', {
                error: e.message,
                key: message.key
            });
            return;
        }

        const {
            taskId, filepath, byteRangeStart, byteRangeEnd, rangeIndex, totalRanges, taskTotalRanges, fileSize,
            user, scope, alternateUserId, isUser, remoteIpAddress
        } = eventData;
        const rangeStartTimeMs = Date.now();

        logInfo('Processing bulk import range', {
            taskId,
            filepath,
            byteRangeStart,
            byteRangeEnd,
            rangeIndex,
            totalRanges
        });

        // This worker never reads or writes the Task resource -- the orchestrator is the sole
        // Task writer (see class docstring), so "did this range start" is reported
        // unconditionally rather than gated on a Task read here; the orchestrator's own
        // read-before-write only flips status if it's still 'requested'.
        await this.bulkImportEventProducer.publishRangeProgressEventAsync({
            type: 'ImportRangeStarted',
            data: { taskId, filepath, rangeIndex, taskTotalRanges }
        });

        const requestInfo = this.buildRangeRequestInfo({ user, scope, alternateUserId, isUser, remoteIpAddress });

        const base_version = '4_0_0';
        const batchSize = this.configManager.bulkImportBatchSize;
        const batchDelayMs = this.configManager.bulkImportBatchDelayMs;

        let linesRead = 0;
        let sinceLastFlush = 0;
        let created = 0;
        let updated = 0;
        let failed = 0;
        let skipped = 0;
        const mergeResultEntries = [];

        // fastDatabaseBulkInserter buffers queued resources and only builds their
        // MergeResultEntry once a batch actually flushes to Mongo, by which point the
        // line's byteOffset is no longer in scope there -- so we track it here, keyed by
        // resourceType+id, and re-attach it to the returned entry in flushBatchAsync below.
        // Restores output ordering to match the source file regardless of when within a
        // batch a given line's write actually commits.
        const byteOffsetByUuid = new Map();

        // Set once this attempt's first flush actually writes to Mongo (and possibly
        // ClickHouse/Kafka-ClickPipe for clickHouseOnlyResources) -- see
        // readRangeWithRetryAsync's docstring for why retry must stop once this is true.
        let hasFlushedThisAttempt = false;

        // Buffers a batch's successfully-serialized (non-skipped) resources so their
        // create/update status can be resolved with one pre-loaded databaseBulkLoader lookup
        // per resourceType instead of a fastFindOneAsync round trip per line -- see Shubham's
        // PR #2528 review comment (per-line existence-check cost tradeoff).
        let pendingMergeResources = [];

        // ifNoneExist criteria "claimed" by a resource already queued for merge in this
        // attempt but not yet flushed to Mongo. findExistingResourceForIfNoneExistAsync only
        // sees committed state, so two wrapped lines with the same match criteria landing in
        // the same unflushed batch would otherwise both pass the existence check and both get
        // created. Declared here (not inside readAndProcessRangeAsync) so
        // mergeBufferedResourceAsync -- a sibling closure, invoked later from
        // flushBatchAsync -- can unclaim a key if the deferred merge it queued fails.
        let claimedIfNoneExistKeys = new Set();

        const flushBatchAsync = async () => {
            if (pendingMergeResources.length > 0) {
                // Pre-load once for the whole batch (grouped by resourceType internally) so
                // mergeBufferedResourceAsync's getResourceFromExistingList() calls below are
                // in-memory lookups instead of a query per line.
                await this.databaseBulkLoader.loadResourcesAsync({
                    requestId: requestInfo.requestId,
                    base_version,
                    requestedResources: pendingMergeResources.map((p) => p.fhirResource)
                });
                // Tracks _uuids already processed earlier in THIS flush -- databaseBulkLoader's
                // preload only reflects committed DB state, so two lines in the same unflushed
                // batch that resolve to the same _uuid (a literal duplicate, or two lines whose
                // id+sourceAssigningAuthority hash to the same UUID) would otherwise both see
                // wasExisting=false and both get counted/audited as created, even though
                // fastDatabaseBulkInserter correctly routes the second write to an update.
                const uuidsSeenThisFlush = new Set();
                for (const { fhirResource, byteOffset, ifNoneExistKey } of pendingMergeResources) {
                    const wasSeenEarlierThisFlush = uuidsSeenThisFlush.has(fhirResource._uuid);
                    uuidsSeenThisFlush.add(fhirResource._uuid);
                    await mergeBufferedResourceAsync({
                        fhirResource, byteOffset, ifNoneExistKey, forceUpdated: wasSeenEarlierThisFlush
                    });
                }
                pendingMergeResources = [];
            }
            await this.fastDatabaseBulkInserter.executeAsync({ requestInfo, base_version });
            hasFlushedThisAttempt = true;
            sinceLastFlush = 0;
        };

        /**
         * Merges one already-serialized resource via mergeManager.mergeResourceAsync
         * (schema validation + real upsert, instead of fastDatabaseBulkInserter.insertOneAsync's
         * unconditional $setOnInsert) and folds its null/MergeResultEntry return contract into
         * this range's counters/mergeResultEntries.
         * @param {Object} params
         * @param {Object} params.fhirResource
         * @param {number} params.byteOffset
         * @param {string|null} [params.ifNoneExistKey] - already claimed in
         *   claimedIfNoneExistKeys by the caller; unclaimed here on any failure path so a
         *   later duplicate line in this same range isn't permanently blocked from trying
         *   again for a resource that was never actually created.
         * @param {boolean} [params.forceUpdated] - true when an earlier line in this same
         *   unflushed batch already resolved to the same _uuid. databaseBulkLoader's preload
         *   only reflects committed state, so without this override every same-batch
         *   duplicate would see wasExisting=false and get double-counted/audited as created,
         *   even though the underlying ordered bulk write correctly applies the second one as
         *   an update against the first's just-buffered document.
         * @returns {Promise<void>}
         */
        const mergeBufferedResourceAsync = async ({ fhirResource, byteOffset, ifNoneExistKey = null, forceUpdated = false }) => {
            const wasExisting = forceUpdated || !!this.databaseBulkLoader.getResourceFromExistingList({
                requestId: requestInfo.requestId,
                resourceType: fhirResource.resourceType,
                uuid: fhirResource._uuid
            });

            try {
                // mergeManager.mergeResourceAsync trusts its caller to have already enforced
                // scopes -- the real $merge API path always runs WriteAllowedByScopesValidator
                // before ever reaching mergeManager. Without this, an id colliding with
                // another tenant's real _uuid (e.g. isUuid(fhirResource.id) above) could be
                // merged into that tenant's resource with no access-tag check at all.
                const { preCheckErrors: scopeErrors } = await this.writeAllowedByScopesValidator.validate({
                    requestInfo,
                    incomingResources: [fhirResource],
                    base_version,
                    effectiveSmartMerge: true
                });
                if (scopeErrors.length > 0) {
                    failed++;
                    mergeResultEntries.push(...scopeErrors);
                    if (ifNoneExistKey) {
                        claimedIfNoneExistKeys.delete(ifNoneExistKey);
                    }
                    return;
                }

                const validationFailure = await this.mergeManager.mergeResourceAsync({
                    resourceToMerge: fhirResource,
                    resourceType: fhirResource.resourceType,
                    base_version,
                    requestInfo
                });

                if (validationFailure) {
                    failed++;
                    mergeResultEntries.push(validationFailure);
                    if (ifNoneExistKey) {
                        claimedIfNoneExistKeys.delete(ifNoneExistKey);
                    }
                } else if (wasExisting) {
                    updated++;
                    mergeResultEntries.push(new MergeResultEntry({
                        id: fhirResource.id,
                        uuid: fhirResource._uuid,
                        sourceAssigningAuthority: fhirResource._sourceAssigningAuthority,
                        resourceType: fhirResource.resourceType,
                        created: false,
                        updated: true,
                        issue: null,
                        operationOutcome: null,
                        sourceByteOffset: byteOffset
                    }));
                } else {
                    created++;
                    mergeResultEntries.push(new MergeResultEntry({
                        id: fhirResource.id,
                        uuid: fhirResource._uuid,
                        sourceAssigningAuthority: fhirResource._sourceAssigningAuthority,
                        resourceType: fhirResource.resourceType,
                        created: true,
                        updated: false,
                        issue: null,
                        operationOutcome: null,
                        sourceByteOffset: byteOffset
                    }));
                }
            } catch (mergeError) {
                failed++;
                const entryFromError = mergeError.args instanceof MergeResultEntry
                    ? mergeError.args
                    : MergeResultEntry.createFromError({
                        error: mergeError, resource: fhirResource, sourceByteOffset: byteOffset
                    });
                mergeResultEntries.push(entryFromError);
                if (ifNoneExistKey) {
                    claimedIfNoneExistKeys.delete(ifNoneExistKey);
                }
                logError('Failed to merge bulk import resource', {
                    taskId,
                    filepath,
                    resourceType: fhirResource.resourceType,
                    byteOffset,
                    error: mergeError.message
                });
            }
        };

        const readAndProcessRangeAsync = async () => {
            // Reset accumulators -- a retry reprocesses the WHOLE range from the start, so
            // a partial attempt's counts/entries must not carry over into the next one.
            linesRead = 0;
            sinceLastFlush = 0;
            created = 0;
            updated = 0;
            failed = 0;
            skipped = 0;
            mergeResultEntries.length = 0;
            byteOffsetByUuid.clear();
            hasFlushedThisAttempt = false;
            pendingMergeResources = [];
            claimedIfNoneExistKeys = new Set();

            try {
                for await (const { lineNumber, byteOffset, resource, parseError } of this.s3NdjsonReader.readNdjsonAsync({
                    filepath,
                    byteRangeStart,
                    byteRangeEnd,
                    fileSize
                })) {
                    linesRead++;
                    sinceLastFlush++;

                    if (parseError) {
                        failed++;
                        // A single bad line (too large, unparseable) doesn't abort the range --
                        // record it the same way a per-resource write failure is recorded, so
                        // it lands in the error NDJSON and Task.output instead of silently
                        // failing the whole import.
                        mergeResultEntries.push(
                            MergeResultEntry.createFromError({ error: parseError, resource: {}, sourceByteOffset: byteOffset })
                        );
                        logError('Invalid NDJSON line skipped', {
                            taskId,
                            filepath,
                            lineNumber,
                            byteOffset,
                            error: parseError.message
                        });
                    } else {
                        // Duplicate-prevention wrapper: { ifNoneExist, resource } instead of a
                        // plain resource line. A real FHIR resource never has a top-level
                        // "ifNoneExist" field, so this check doesn't collide with plain lines.
                        const isIfNoneExistWrapper = resource && typeof resource.ifNoneExist === 'string' &&
                            resource.resource && typeof resource.resource === 'object';
                        const innerResource = isIfNoneExistWrapper ? resource.resource : resource;

                        try {
                            const fhirResource = FhirResourceWriteSerializer.serialize({
                                obj: this.applyDefaultSecurityTagsIfMissing(innerResource)
                            });

                            // mergeManager.mergeResourceAsync requires _uuid to already be set --
                            // mirrors MergeResourceValidator's own pre-merge assignment (the same
                            // rule $merge's API path uses) since serialize() doesn't compute it.
                            if (isUuid(fhirResource.id)) {
                                fhirResource._uuid = fhirResource.id;
                            } else {
                                await this.sourceAssigningAuthorityColumnHandler.preSaveAsync({ resource: fhirResource });
                                await this.uuidColumnHandler.preSaveAsync({ resource: fhirResource });
                            }

                            let existingResource = null;
                            let ifNoneExistKey = null;
                            if (isIfNoneExistWrapper) {
                                const securityTags = fhirResource.meta?.security || [];
                                // Mirrors OwnerColumnHandler's own fallback rule -- a resource
                                // may arrive with only an access tag and no owner tag yet
                                // (OwnerColumnHandler backfills the owner from the first access
                                // tag, but only later during preSave, after this check runs).
                                const ownerCode = securityTags.find((tag) => tag.system === SecurityTagSystem.owner)?.code ||
                                    securityTags.find((tag) => tag.system === SecurityTagSystem.access)?.code;

                                ifNoneExistKey = `${fhirResource.resourceType}|${ownerCode}|${resource.ifNoneExist}`;
                                if (claimedIfNoneExistKeys.has(ifNoneExistKey)) {
                                    // Another line earlier in this same unflushed batch already
                                    // claimed this criteria -- treat as a match without a redundant
                                    // (and stale, since the earlier insert isn't committed yet) query.
                                    existingResource = true;
                                } else {
                                    existingResource = await this.findExistingResourceForIfNoneExistAsync({
                                        resourceType: fhirResource.resourceType,
                                        ifNoneExist: resource.ifNoneExist,
                                        ownerCode
                                    });
                                }
                            }

                            if (existingResource) {
                                skipped++;
                                mergeResultEntries.push(new MergeResultEntry({
                                    id: fhirResource.id,
                                    uuid: fhirResource._uuid,
                                    sourceAssigningAuthority: fhirResource._sourceAssigningAuthority,
                                    resourceType: fhirResource.resourceType,
                                    created: false,
                                    updated: false,
                                    issue: null,
                                    operationOutcome: null,
                                    sourceByteOffset: byteOffset
                                }));
                                logInfo('Skipped bulk import resource: matched existing via ifNoneExist', {
                                    taskId,
                                    filepath,
                                    lineNumber,
                                    byteOffset,
                                    resourceType: fhirResource.resourceType,
                                    ifNoneExist: resource.ifNoneExist
                                });
                            } else {
                                // Claim immediately so a duplicate line later in this same
                                // unflushed batch sees it, but pass the key through to
                                // mergeBufferedResourceAsync (run later, from flushBatchAsync)
                                // so it can UNCLAIM if the deferred merge itself fails --
                                // otherwise a validation/scope failure here would permanently
                                // (for the rest of this range) block any later duplicate line
                                // with the same criteria from ever being tried again, since
                                // nothing was actually created.
                                if (ifNoneExistKey) {
                                    claimedIfNoneExistKeys.add(ifNoneExistKey);
                                }
                                pendingMergeResources.push({ fhirResource, byteOffset, ifNoneExistKey });
                            }
                        } catch (resourceError) {
                            failed++;
                            // Failed before reaching the bulk inserter (e.g. missing/unsupported
                            // resourceType) — still record it so it lands in the error NDJSON and
                            // Task.output, not just a log line.
                            mergeResultEntries.push(
                                MergeResultEntry.createFromError({ error: resourceError, resource: innerResource, sourceByteOffset: byteOffset })
                            );
                            logError('Failed to buffer bulk import resource for write', {
                                taskId,
                                filepath,
                                lineNumber,
                                byteOffset,
                                error: resourceError.message
                            });
                        }
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
                if (hasFlushedThisAttempt) {
                    e.bulkImportRangePartiallyFlushed = true;
                }
                throw e;
            }
        };

        try {
            try {
                await this.readRangeWithRetryAsync({
                    fn: readAndProcessRangeAsync,
                    requestId: requestInfo.requestId
                });
            } catch (e) {
                logError('Error reading S3 NDJSON range', {
                    taskId,
                    filepath,
                    rangeIndex,
                    error: e.message
                });
                // Reports unconditionally -- this worker doesn't read the Task, so it can't
                // know whether the Task already completed (e.g. every other range finished
                // while this one was retrying). The orchestrator's own read-before-write
                // decides whether a 'failed' status would regress an already-'completed' Task
                // and skips it if so; a redelivery of this same failure report is likewise
                // resolved there, not here.
                await this.bulkImportEventProducer.publishRangeProgressEventAsync({
                    type: 'ImportRangeFailed',
                    data: { taskId, filepath, rangeIndex, taskTotalRanges, errorMessage: e.message }
                });
                recordImportSpanAttributes({ 'fhir_import.outcome': 'failed' });
                // mergeResultEntries only ever gains entries once a batch actually commits
                // (flushBatchAsync) or a per-line failure is recorded -- so on a partially-
                // flushed range (bulkImportRangePartiallyFlushed), these resources are already
                // durably persisted even though the range as a whole failed. This range won't
                // be redelivered once the Task is 'failed', so without this the flushed
                // resources would never get an AuditEvent.
                this.queueAuditEntriesForRangeAsync({
                    requestInfo,
                    base_version,
                    mergeResultEntries,
                    taskId,
                    filepath,
                    rangeIndex,
                    totalRanges
                });
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
                failed,
                skipped
            });

            await this.reportRangeCompletedAsync({
                taskId,
                filepath,
                rangeIndex,
                taskTotalRanges,
                mergeResultEntries
            });

            this.queueAuditEntriesForRangeAsync({
                requestInfo,
                base_version,
                mergeResultEntries,
                taskId,
                filepath,
                rangeIndex,
                totalRanges
            });
        } finally {
            // Emitted here (not at the success-return point above) so a range that fails
            // after a partial flush -- or is redelivered and fails again -- still surfaces
            // whatever mergeResultEntries this attempt actually produced, mirroring the
            // merge boundary's finally-based emission (see docs/adr/0002).
            recordImportResourceOutcomes(mergeResultEntries);
            recordImportRangeDuration((Date.now() - rangeStartTimeMs) / 1000);
            // Per-range counts as span attributes (see recordImportSpanAttributes'
            // docstring) -- covers both success and partial-flush-then-fail, same finally-based
            // rationale as the two calls above.
            recordImportSpanAttributes({
                'fhir_import.resources_created': created,
                'fhir_import.resources_updated': updated,
                'fhir_import.resources_failed': failed
            });

            // FastDatabaseBulkInserter defers history writes onto postRequestProcessor's
            // queue rather than writing them inline — without this, history writes for
            // every bulk-imported resource would be silently dropped. RequestSpecificCache
            // entries are also only ever freed by an explicit clearAsync, so skipping this
            // would leak one entry per Kafka message in this long-running consumer.
            await this.postRequestProcessor.executeAsync({ requestId: requestInfo.requestId });
            // AuditLogger.logAuditEntryAsync only buffers AuditEvent docs in-memory --
            // flushAsync() is what actually writes them via the bulk inserter. In the main
            // FHIR server this runs on a periodic cron (see cronTasksProcessor.js), but this
            // process never starts that cron (only src/index.js does), so nothing would ever
            // persist these without flushing explicitly here. Guarded because it can throw
            // (e.g. a transient Mongo write failure) -- the range's writes and Task completion
            // have already succeeded by this point, so an audit-flush hiccup must not skip
            // the cache cleanup below or propagate out and cause this already-completed range
            // to be redelivered/reprocessed.
            try {
                await this.auditLogger.flushAsync();
            } catch (auditFlushError) {
                logError('Failed to flush AuditEvents for bulk import range', {
                    taskId,
                    filepath,
                    rangeIndex,
                    error: auditFlushError.message
                });
            }
            await this.requestSpecificCache.clearAsync({ requestId: requestInfo.requestId });
        }
    }

    /**
     * Queues AuditEvent entries for every resource this range created/updated/failed,
     * grouped by resourceType, mirroring MergeManager.logAuditEntriesForMergeResults --
     * the same pattern the $merge operation uses. Deferred via postRequestProcessor so it
     * runs alongside the other end-of-range cleanup in the finally block below.
     * @param {Object} params
     * @param {FhirRequestInfo} params.requestInfo
     * @param {string} params.base_version
     * @param {import('../../common/mergeResultEntry').MergeResultEntry[]} params.mergeResultEntries
     * @param {string} params.taskId
     * @param {string} params.filepath
     * @param {number} params.rangeIndex
     * @param {number} params.totalRanges
     * @returns {void}
     */
    queueAuditEntriesForRangeAsync({
        requestInfo, base_version, mergeResultEntries, taskId, filepath, rangeIndex, totalRanges
    }) {
        this.postRequestProcessor.add({
            requestId: requestInfo.requestId,
            fnTask: async () => {
                const args = { taskId, filepath, rangeIndex, totalRanges };
                const groupByResourceType = groupByLambda(mergeResultEntries, (entry) => entry.resourceType);

                for (const [resourceType, entriesForResourceType] of Object.entries(groupByResourceType)) {
                    const failedItems = entriesForResourceType.filter((r) => r.issue);

                    if (resourceType !== 'AuditEvent') {
                        // we don't log success (create/update) audits on AuditEvent itself
                        const createdItems = entriesForResourceType.filter((r) => r.created === true);
                        const updatedItems = entriesForResourceType.filter((r) => r.updated === true);
                        if (createdItems.length > 0) {
                            await this.auditLogger.logAuditEntryAsync({
                                requestInfo,
                                base_version,
                                resourceType,
                                operation: 'create',
                                args,
                                ids: createdItems.map((r) => r._uuid)
                            });
                        }
                        if (updatedItems.length > 0) {
                            await this.auditLogger.logAuditEntryAsync({
                                requestInfo,
                                base_version,
                                resourceType,
                                operation: 'update',
                                args,
                                ids: updatedItems.map((r) => r._uuid)
                            });
                        }
                    }
                    // error audits are logged for all resource types, including AuditEvent,
                    // to match mergeManager's logAuditEntriesForMergeResults.
                    for (const entry of failedItems) {
                        await this.auditLogger.logErrorAuditEntryAsync({
                            requestInfo,
                            resourceType,
                            errorCode: 400,
                            errorMessage: `${resourceType}/${entry.id}: bulk import failure`
                        });
                    }
                }
            }
        });
    }
}

module.exports = { BulkImportHandler };
