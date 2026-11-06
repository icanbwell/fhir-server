'use strict';

/**
 * Custom OpenTelemetry instruments for fhir-server domain signals.
 *
 * # Why ambient module instead of constructor injection
 *
 * The OTel meter is process-wide ambient by construction. Pretending it's a
 * domain dependency that flows through DI cascades a constructor parameter
 * across every consumer (and every test that builds those consumers). Three
 * review rounds of a strict-DI version produced repeated breakage in unrelated
 * test files (constructor cascade) and scattered emission across 13 sites,
 * each independently responsible for partitioning correctly. We chose ambient
 * + boundary emission instead.
 *
 * Emission lives at a small set of domain-boundary choke points (six call
 * lines across four files: merge.js mergeAsync + executeMerge, resourceValidator.js,
 * everythingHelper.js, kafkaClient.js). Each call site has the function-return
 * scope containing all data needed — no scatter, no synchronization burden.
 *
 * BAI-229 extends the same pattern to bulk $import: three more choke points
 * (BulkImportHandler.handleTaskCreatedAsync + headS3FilesAsync,
 * BulkImportHandler.handleImportRangeRequestedAsync, S3NdjsonReader.readNdjsonAsync).
 * `recordImportResourceOutcomes` reuses `tallyMergeOutcomes` unchanged — a bulk-import
 * byte range produces the same `MergeResultEntry[]` shape a merge does, so the
 * per-resource-type tally logic (and its disjointness guarantee) applies as-is.
 *
 * # Why finally for emission, not by construction
 *
 * Some boundaries (mergeAsync, executeMerge) have a try/catch that rethrows or
 * an AbortError fallthrough that returns without rethrow. Emission must fire
 * on every exit path including abort and rethrow, so emission goes in `finally`,
 * not at the success-return point. The "regression-revert smoke" test in the
 * acceptance criteria flips finally to a success-return-only emission and
 * confirms an integration test fails — that is how we know the finally is
 * load-bearing.
 *
 * # Test seam: spy on the OTel instrument, never on the recording wrapper
 *
 * `metrics.mergeOutcomeCounter` etc. are property-on-the-module-object, so
 * `jest.spyOn(metrics, 'mergeOutcomeCounter.add')` works (use the OTel
 * instrument's own `.add` / `.record`). Spying on `metrics.recordMergeOutcomes`
 * gives FALSE GREENS when the production code does
 * `const { recordMergeOutcomes } = require('./metrics')` — the destructured
 * binding captures the original function before the spy replaces the property.
 * Pure-logic helpers (`tallyMergeOutcomes`, `worstSeverity`) are tested by
 * direct call, no spy.
 *
 * # PHI label discipline
 *
 * Label vocabularies are bounded sets defined as frozen constants. Never label
 * by id, _uuid, sourceAssigningAuthority, free-text fields, or anything
 * patient-identifying. Adding a label is additive only — never remove or
 * rename existing labels (per AGENTS.md schema evolution rule).
 *
 * See: docs/adr/0002-custom-opentelemetry-meters-via-dependency-injection.md
 */

const { metrics: otelMetrics } = require('@opentelemetry/api');
const { fhirSchemaValidator } = require('./fhirSchemaValidator');

const LABEL = Object.freeze({
    OUTCOME: 'outcome',
    RESOURCE_TYPE: 'resource_type',
    VALIDATION_STAGE: 'validation_stage',
    SEVERITY: 'severity',
    DIRECTION: 'direction',
    OPERATION: 'operation',
    TOPIC: 'topic',
    ERROR_CODE: 'error_code',
    SUBSYSTEM: 'subsystem',
    PATH: 'path',
    POOL: 'pool',
    REASON: 'reason',
    STATUS: 'status',
    GROUP_ID: 'group_id'
});

const OUTCOME = Object.freeze({
    CREATED: 'created',
    UPDATED: 'updated',
    ERROR: 'error'
});

const VALIDATION_STAGE = Object.freeze({
    SCHEMA: 'schema',
    META: 'meta',
    REFERENCE: 'reference'
});

const DIRECTION = Object.freeze({
    INBOUND: 'inbound',
    OUTBOUND: 'outbound'
});

const OPERATION = Object.freeze({
    MERGE: 'merge',
    NDJSON: 'ndjson',
    EVERYTHING: 'everything'
});

const SUBSYSTEM = Object.freeze({
    KAFKA: 'kafka'
});

// The MongoDB driver's ConnectionCheckOutFailedEvent.reason values (mongodb 7.3.0,
// cmap/connection_pool.js). Bounded here rather than passed through, so a future driver
// version introducing a new reason string cannot silently widen label cardinality --
// anything unrecognized collapses to UNKNOWN.
const POOL_CHECKOUT_FAILURE_REASON = Object.freeze({
    TIMEOUT: 'timeout',
    POOL_CLOSED: 'poolClosed',
    CONNECTION_ERROR: 'connectionError'
});

// Distinguishes save-time validation (POST/PUT/$merge) from validate-time
// validation ($validate). Same instrument, different label values.
const PATH = Object.freeze({
    SAVE: 'save',
    VALIDATE: 'validate'
});

// What happened to one ImportRangeRequested message. published is counted by the
// orchestrator at split time; the rest by the worker. published minus (completed + failed)
// is the live backlog; the skipped_* values are redeliveries, i.e. wasted work.
const IMPORT_RANGE_OUTCOME = Object.freeze({
    PUBLISHED: 'published',
    STARTED: 'started',
    COMPLETED: 'completed',
    FAILED: 'failed',
    SKIPPED_DUPLICATE: 'skipped_duplicate',
    SKIPPED_TASK_FINISHED: 'skipped_task_finished',
    TASK_NOT_FOUND: 'task_not_found'
});

// Terminal Task statuses the orchestrator can write.
const IMPORT_TASK_STATUS = Object.freeze({
    COMPLETED: 'completed',
    FAILED: 'failed'
});

const UNKNOWN = 'unknown';

const SEVERITY_RANK = { error: 3, warning: 2, information: 1 };

/**
 * Worst severity present in an OperationOutcome's issues; null if none.
 * `operationOutcome.issue` is normally an array, but `validateResourceFromServerAsync`
 * sometimes assigns a single `OperationOutcomeIssue` to it — accept both shapes.
 *
 * @param {OperationOutcome|null|undefined} operationOutcome
 * @returns {string|null}
 */
function worstSeverity (operationOutcome) {
    if (!operationOutcome) {
        return null;
    }
    const issues = Array.isArray(operationOutcome.issue)
        ? operationOutcome.issue
        : (operationOutcome.issue ? [operationOutcome.issue] : []);
    let worst = null;
    let worstRank = 0;
    for (const issue of issues) {
        const sev = issue && issue.severity;
        const rank = SEVERITY_RANK[sev] || 0;
        if (rank > worstRank) {
            worst = sev;
            worstRank = rank;
        }
    }
    return worst;
}

/**
 * Pure-logic tally of MergeResultEntry list by (outcome, resource_type).
 * Returns Map<"outcome|resource_type", count>.
 *
 * Outcome derivation:
 *   created       => OUTCOME.CREATED
 *   updated       => OUTCOME.UPDATED
 *   issue present => OUTCOME.ERROR
 *   otherwise     => skipped (placeholder unchanged entry; no signal)
 *
 * Skip guard: when a Bundle resource fails 400-level validation,
 * `BundleResourceValidator` returns the OperationOutcome itself as a
 * preCheckErrors entry. Tallying that would mislabel `OperationOutcome` as a
 * resource_type and double-count the bundle's intended payload. We skip any
 * entry whose `resourceType === 'OperationOutcome'`.
 *
 * @param {Array<{created?: boolean, updated?: boolean, issue?: any, resourceType?: string}>} entries
 * @returns {Map<string, number>}
 */
function tallyMergeOutcomes (entries) {
    const tallies = new Map();
    if (!entries || entries.length === 0) {
        return tallies;
    }
    for (const entry of entries) {
        if (!entry) {
            continue;
        }
        if (entry.resourceType === 'OperationOutcome') {
            continue;
        }
        let outcome;
        if (entry.created) {
            outcome = OUTCOME.CREATED;
        } else if (entry.updated) {
            outcome = OUTCOME.UPDATED;
        } else if (entry.issue) {
            outcome = OUTCOME.ERROR;
        } else {
            continue;
        }
        const resourceType = entry.resourceType || UNKNOWN;
        const key = `${outcome}|${resourceType}`;
        tallies.set(key, (tallies.get(key) || 0) + 1);
    }
    return tallies;
}

const meter = otelMetrics.getMeter('fhir-server');

const mergeOutcomeCounter = meter.createCounter('fhir_merge_outcome_total', {
    description: 'Per-resource merge persistence outcomes (created/updated/error). Not patient-match confirmation.'
});

const validationFailureCounter = meter.createCounter('fhir_validation_failure_total', {
    description: 'FHIR validation failures by resource_type, validation_stage, path (save|validate), and worst severity present. Increments once per resource with any error-severity issue, not per issue.'
});

const bundleSizeHistogram = meter.createHistogram('fhir_bundle_size_entries', {
    description: 'Bundle entry counts by direction (inbound/outbound) and operation (merge/ndjson/everything).',
    unit: '1',
    advice: {
        explicitBucketBoundaries: [1, 10, 50, 100, 500, 1000, 5000, 10000, 50000]
    }
});

const everythingEmptyCounter = meter.createCounter('fhir_everything_empty_total', {
    description: 'Successful $everything responses returning a zero-entry bundle. Read-correctness signal: a 200 with an empty bundle is the consumer getting nothing while HTTP and latency look green.'
});

const kafkaRetryExhaustedCounter = meter.createCounter('fhir_kafka_retry_exhausted_total', {
    description: 'Kafka producer retry-loop exhaustion. Increments only when the retry loop runs out without success.'
});

const historyKafkaProducedCounter = meter.createCounter('fhir_history_kafka_produced_total', {
    description: 'History events successfully produced to Kafka, by resource_type.'
});

const historyKafkaFailedCounter = meter.createCounter('fhir_history_kafka_produce_failed_total', {
    description: 'History events that could not be produced to Kafka after retries, by resource_type. The MongoDB history write is unaffected.'
});

const historyKafkaProduceDurationHistogram = meter.createHistogram('fhir_history_kafka_produce_duration_seconds', {
    description: 'Wall-clock duration of one history Kafka produce call (including retries), by resource_type.',
    unit: 's'
});

const historyClickHouseReadsCounter = meter.createCounter('fhir_history_clickhouse_reads_total', {
    description: 'ClickHouse-backed _history reads, by resource_type and outcome (success/error).'
});

const historyClickHouseReadDurationHistogram = meter.createHistogram('fhir_history_clickhouse_read_duration_seconds', {
    description: 'Wall-clock duration of one ClickHouse _history query, by resource_type.',
    unit: 's'
});

const historyClickHouseReadRowsHistogram = meter.createHistogram('fhir_history_clickhouse_read_rows', {
    description: 'History rows returned by one ClickHouse _history query, by resource_type.'
});

const historyMongoFallbackCounter = meter.createCounter('fhir_history_mongo_fallback_total', {
    description: 'History documents written to MongoDB because the Kafka produce failed while the MongoDB history write is disabled, by resource_type and reason.'
});

const importOperationsTriggeredCounter = meter.createCounter('fhir_import_operations_triggered_total', {
    description: 'Bulk $import operations triggered — one per TaskCreated event the orchestrator begins processing (Task found, before S3 validation).'
});

const importResourcesProcessedCounter = meter.createCounter('fhir_import_resources_processed_total', {
    description: 'Bulk-imported resources successfully written, by resource_type and outcome (created/updated).'
});

const importResourcesFailedCounter = meter.createCounter('fhir_import_resources_failed_total', {
    description: 'Bulk-imported resources that failed to write, by resource_type.'
});

const importRangeDurationHistogram = meter.createHistogram('fhir_import_range_duration_seconds', {
    description: 'Wall-clock duration of processing a single bulk-import byte range (ImportRangeRequested), success or failure.',
    unit: 's'
});

const importS3ReadThroughputHistogram = meter.createHistogram('fhir_import_s3_read_throughput_bytes_per_second', {
    description: 'Effective S3 read throughput for a bulk-import byte range: bytes read divided by read duration. Recorded even on partial/aborted reads.',
    unit: 'By/s',
    // Default OTel bucket boundaries top out around 10000 -- far too small for throughput
    // measured in bytes/sec (real imports run in the hundreds of KB/s to tens of MB/s), which
    // clamps every observation into the overflow bucket and makes quantile queries meaningless.
    advice: {
        explicitBucketBoundaries: [1000, 10000, 100000, 500000, 1000000, 5000000, 10000000, 50000000]
    }
});

const importFileSizeHistogram = meter.createHistogram('fhir_import_file_size_bytes', {
    description: 'Size (bytes) of each S3 input file validated for bulk import.',
    unit: 'By',
    // Same overflow-bucket problem as the throughput histogram above -- file sizes run into the
    // tens/hundreds of MB, well past the default boundaries' ~10000 ceiling.
    advice: {
        explicitBucketBoundaries: [1000, 10000, 100000, 1000000, 5000000, 10000000, 50000000, 100000000, 500000000]
    }
});

const importRangesCounter = meter.createCounter('fhir_import_ranges_total', {
    description: 'Bulk-import byte ranges by outcome (published|started|completed|failed|skipped_duplicate|skipped_task_finished|task_not_found). published - (completed + failed) is the backlog; skipped_* are redeliveries.'
});

const importTasksCounter = meter.createCounter('fhir_import_tasks_total', {
    description: 'Bulk $import Tasks that reached a terminal status (completed|failed), counted when the orchestrator writes that status.'
});

const importTaskDurationHistogram = meter.createHistogram('fhir_import_task_duration_seconds', {
    description: 'Wall-clock time from Task.authoredOn to the orchestrator writing a terminal status, by status.',
    unit: 's',
    // Imports run for minutes to days, far past the default ~10s ceiling.
    advice: {
        explicitBucketBoundaries: [60, 300, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400, 172800]
    }
});

const kafkaConsumerGroupJoinsCounter = meter.createCounter('fhir_kafka_consumer_group_joins_total', {
    description: 'Consumer GROUP_JOIN events by group_id. One per consumer start is normal; a steady rate is rebalance or eviction churn (kafkajs rejoins after UNKNOWN_MEMBER_ID without emitting REBALANCING, so this is the only count that sees evictions).'
});

const mongoPoolCheckoutDurationHistogram = meter.createHistogram('fhir_mongo_pool_checkout_duration_seconds', {
    description: 'Time a request waited to check a connection out of a MongoDB pool, by pool. Recorded for successful and failed checkouts alike. This wait is invisible to the OTel mongodb instrumentation, which spans only the wire command -- a starved pool shows up there as a fast query preceded by nothing.',
    unit: 's',
    // A healthy checkout is sub-millisecond, so the low buckets are tight. The high buckets
    // exist because real incidents land there: a staging $merge burst produced a 13s pool
    // wait, and a checkout that hits waitQueueTimeoutMS would land at that timeout's value.
    advice: {
        explicitBucketBoundaries: [0.0005, 0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10, 30]
    }
});

const mongoPoolCheckoutFailedCounter = meter.createCounter('fhir_mongo_pool_checkout_failed_total', {
    description: 'MongoDB connection checkout failures by pool and reason (timeout|poolClosed|connectionError|unknown).'
});

const mongoPoolClearedCounter = meter.createCounter('fhir_mongo_pool_cleared_total', {
    description: 'MongoDB connection pool clears by pool. The driver clears a pool when it marks a server Unknown, so this rising alongside latency means SDAM churn rather than slow queries.'
});

const mongoPoolConnectionCreatedCounter = meter.createCounter('fhir_mongo_pool_connection_created_total', {
    description: 'MongoDB connections created by pool. On a warm pool this should sit near zero; a sustained rate means churn, which puts the SCRAM auth handshake on the request hot path.'
});

/**
 * Splits a `tallyMergeOutcomes` composite key ("outcome|resourceType") back into its parts.
 * Shared by recordMergeOutcomes and recordImportResourceOutcomes so the key format has one
 * decoder, not two copies that could drift.
 * @param {string} key
 * @returns {{outcome: string, resourceType: string}}
 */
function decodeOutcomeTallyKey (key) {
    const sep = key.indexOf('|');
    return { outcome: key.substring(0, sep), resourceType: key.substring(sep + 1) };
}

/**
 * Memoized Set of every FHIR R4 resourceType this server knows about (same source
 * fhirSchemaValidator uses to validate saves -- see resourceValidator.js), lazily built on
 * first use rather than at module load so a test that mocks @opentelemetry/api but never
 * touches import metrics doesn't pay for it.
 * @returns {Set<string>}
 */
let validResourceTypesSet = null;
function getValidResourceTypesSet () {
    if (!validResourceTypesSet) {
        validResourceTypesSet = new Set(fhirSchemaValidator.getAllResourceTypes());
    }
    return validResourceTypesSet;
}

/**
 * Tally `entries` and emit fhir_merge_outcome_total once per (outcome,
 * resource_type) tuple.
 *
 * Caller contract: pass the entries representing a single emission window.
 * For non-streaming merge, that's the complete `mergeResults` list at function
 * exit. For streaming merge, the streaming transform pushes pre-check errors
 * and bulk-write outcomes onto a single `finalMergeResults` list disjoint by
 * UUID; emission happens once at pipeline finally. One tally per window
 * yields exactly one increment per resource.
 *
 * @param {Array<{created?: boolean, updated?: boolean, issue?: any, resourceType?: string}>} entries
 */
function recordMergeOutcomes (entries) {
    const tallies = tallyMergeOutcomes(entries);
    for (const [key, count] of tallies) {
        const { outcome, resourceType } = decodeOutcomeTallyKey(key);
        mergeOutcomeCounter.add(count, {
            [LABEL.OUTCOME]: outcome,
            [LABEL.RESOURCE_TYPE]: resourceType
        });
    }
}

/**
 * Emit fhir_validation_failure_total once if `operationOutcome` has any
 * error-severity issue. No-op otherwise.
 *
 * @param {OperationOutcome|null|undefined} operationOutcome
 * @param {string} resourceType
 * @param {string} validationStage  one of VALIDATION_STAGE.*
 * @param {string} validationPath   one of PATH.* — defaults to SAVE
 */
function recordValidationFailure (operationOutcome, resourceType, validationStage, validationPath) {
    const severity = worstSeverity(operationOutcome);
    if (severity !== 'error') {
        return;
    }
    validationFailureCounter.add(1, {
        [LABEL.RESOURCE_TYPE]: resourceType || UNKNOWN,
        [LABEL.VALIDATION_STAGE]: validationStage,
        [LABEL.SEVERITY]: severity,
        [LABEL.PATH]: validationPath || PATH.SAVE
    });
}

/**
 * Emit fhir_bundle_size_entries with direction=inbound for a merge boundary.
 * Always fires — inside try/finally on the calling boundary so abort/rethrow
 * paths still emit.
 *
 * @param {string} operation  one of OPERATION.* (typically MERGE or NDJSON)
 * @param {number} entryCount
 */
function recordInboundBundleSize (operation, entryCount) {
    bundleSizeHistogram.record(entryCount, {
        [LABEL.DIRECTION]: DIRECTION.INBOUND,
        [LABEL.OPERATION]: operation || UNKNOWN
    });
}

/**
 * Emit fhir_bundle_size_entries with direction=outbound and (when entryCount===0)
 * fhir_everything_empty_total. One call covers both streaming and non-streaming
 * $everything modes — the caller resolves entry count based on
 * `responseStreamer ? streamedResources.length : (bundle.entry?.length ?? 0)`.
 *
 * @param {string} resourceType
 * @param {number} entryCount
 */
function recordOutboundEverything (resourceType, entryCount) {
    bundleSizeHistogram.record(entryCount, {
        [LABEL.DIRECTION]: DIRECTION.OUTBOUND,
        [LABEL.OPERATION]: OPERATION.EVERYTHING,
        [LABEL.RESOURCE_TYPE]: resourceType || UNKNOWN
    });
    if (entryCount === 0) {
        everythingEmptyCounter.add(1, {
            [LABEL.RESOURCE_TYPE]: resourceType || UNKNOWN
        });
    }
}

/**
 * Emit fhir_kafka_retry_exhausted_total when a Kafka producer retry loop
 * completes without success.
 *
 * @param {string} topic
 * @param {string|number|null|undefined} errorCode
 */
function recordKafkaRetryExhausted (topic, errorCode) {
    kafkaRetryExhaustedCounter.add(1, {
        [LABEL.TOPIC]: topic || UNKNOWN,
        [LABEL.ERROR_CODE]: errorCode != null ? String(errorCode) : UNKNOWN,
        [LABEL.SUBSYSTEM]: SUBSYSTEM.KAFKA
    });
}

/**
 * Count history documents written to MongoDB because the Kafka produce failed.
 * @param {string} resourceType
 * @param {number} count documents written to MongoDB
 * @param {string} reason why the produce did not succeed
 */
function recordHistoryMongoFallback (resourceType, count, reason) {
    historyMongoFallbackCounter.add(count, {
        [LABEL.RESOURCE_TYPE]: resourceType || UNKNOWN,
        [LABEL.REASON]: reason || UNKNOWN
    });
}

/**
 * Emit history Kafka produce metrics for one produce call (a chunk of messages).
 * @param {string} resourceType
 * @param {number} count messages in the call
 * @param {boolean} success
 * @param {number} durationSeconds
 */
function recordHistoryKafkaProduce (resourceType, count, success, durationSeconds) {
    const labels = { [LABEL.RESOURCE_TYPE]: resourceType || UNKNOWN };
    (success ? historyKafkaProducedCounter : historyKafkaFailedCounter).add(count, labels);
    historyKafkaProduceDurationHistogram.record(durationSeconds, labels);
}

/**
 * Record one ClickHouse-backed _history query.
 * @param {string} resourceType
 * @param {boolean} success
 * @param {number} rows rows returned (0 on failure)
 * @param {number} durationSeconds
 */
function recordHistoryClickHouseRead (resourceType, success, rows, durationSeconds) {
    const labels = { [LABEL.RESOURCE_TYPE]: resourceType || UNKNOWN };
    historyClickHouseReadsCounter.add(1, { ...labels, [LABEL.OUTCOME]: success ? 'success' : OUTCOME.ERROR });
    historyClickHouseReadDurationHistogram.record(durationSeconds, labels);
    if (success) {
        historyClickHouseReadRowsHistogram.record(rows, labels);
    }
}

/**
 * Emit fhir_import_operations_triggered_total once per TaskCreated event the
 * orchestrator begins processing.
 */
function recordImportOperationTriggered () {
    importOperationsTriggeredCounter.add(1);
}

/**
 * Tally a bulk-import byte range's `MergeResultEntry[]` (identical shape to a merge's
 * mergeResults) and emit fhir_import_resources_processed_total (created/updated) or
 * fhir_import_resources_failed_total (error), once per (outcome, resource_type) tuple.
 * Reuses `tallyMergeOutcomes` unchanged -- see module docstring.
 * @param {Array<{created?: boolean, updated?: boolean, issue?: any, resourceType?: string}>} entries
 */
function recordImportResourceOutcomes (entries) {
    const tallies = tallyMergeOutcomes(entries);
    const validResourceTypes = getValidResourceTypesSet();
    for (const [key, count] of tallies) {
        const { outcome, resourceType: rawResourceType } = decodeOutcomeTallyKey(key);
        // Unlike merge's resourceType (already routed through a real endpoint), a bulk-import
        // NDJSON line's resourceType can reach here straight from unvalidated input -- e.g.
        // handler.js's resourceError catch records a MergeResultEntry for a bad/unsupported
        // resourceType that failed before FhirResourceWriteSerializer could validate it. Bound
        // it to the known FHIR resourceType vocabulary before it becomes a label: an unbounded
        // string here would let a single malicious/malformed upload explode this instrument's
        // cardinality, and risks free-text/PHI-shaped input leaking into a metric label -- both
        // forbidden by the PHI label discipline in this module's docstring.
        const resourceType = validResourceTypes.has(rawResourceType) ? rawResourceType : UNKNOWN;
        if (outcome === OUTCOME.ERROR) {
            importResourcesFailedCounter.add(count, {
                [LABEL.RESOURCE_TYPE]: resourceType
            });
        } else {
            importResourcesProcessedCounter.add(count, {
                [LABEL.OUTCOME]: outcome,
                [LABEL.RESOURCE_TYPE]: resourceType
            });
        }
    }
}

/**
 * Emit fhir_import_range_duration_seconds for a single bulk-import byte range.
 * @param {number} durationSeconds
 */
function recordImportRangeDuration (durationSeconds) {
    importRangeDurationHistogram.record(durationSeconds);
}

/**
 * Emit fhir_import_s3_read_throughput_bytes_per_second for a single bulk-import S3 read.
 * No-op when durationSeconds is not positive (e.g. failure before any time elapsed) to
 * avoid a divide-by-zero / Infinity data point.
 * @param {number} bytesRead
 * @param {number} durationSeconds
 */
function recordImportS3ReadThroughput (bytesRead, durationSeconds) {
    if (!(durationSeconds > 0)) {
        return;
    }
    importS3ReadThroughputHistogram.record(bytesRead / durationSeconds);
}

/**
 * Emit fhir_import_file_size_bytes for a single S3 input file validated for bulk import.
 * @param {number} fileSizeBytes
 */
function recordImportFileSize (fileSizeBytes) {
    importFileSizeHistogram.record(fileSizeBytes);
}

/**
 * Emit fhir_import_ranges_total. An outcome outside IMPORT_RANGE_OUTCOME collapses to
 * UNKNOWN so a typo cannot widen label cardinality.
 * @param {string} outcome - one of IMPORT_RANGE_OUTCOME
 * @param {number} [count]
 */
function recordImportRanges (outcome, count = 1) {
    if (!(count > 0)) {
        return;
    }
    const isKnown = Object.values(IMPORT_RANGE_OUTCOME).includes(outcome);
    importRangesCounter.add(count, { [LABEL.OUTCOME]: isKnown ? outcome : UNKNOWN });
}

/**
 * Emit fhir_import_tasks_total and, when the duration is known, fhir_import_task_duration_seconds.
 * @param {string} status - one of IMPORT_TASK_STATUS
 * @param {number} [durationSeconds] - omitted or non-finite when Task.authoredOn is missing
 */
function recordImportTaskFinished (status, durationSeconds) {
    const isKnown = Object.values(IMPORT_TASK_STATUS).includes(status);
    const label = { [LABEL.STATUS]: isKnown ? status : UNKNOWN };
    importTasksCounter.add(1, label);
    if (Number.isFinite(durationSeconds) && durationSeconds >= 0) {
        importTaskDurationHistogram.record(durationSeconds, label);
    }
}

/**
 * Emit fhir_kafka_consumer_group_joins_total.
 * @param {string} groupId
 */
function recordKafkaConsumerGroupJoin (groupId) {
    kafkaConsumerGroupJoinsCounter.add(1, { [LABEL.GROUP_ID]: groupId || UNKNOWN });
}

/**
 * Emit fhir_mongo_pool_checkout_duration_seconds. The driver reports the wait in
 * milliseconds; the instrument is in seconds to match the other duration histograms here.
 * @param {string} pool
 * @param {number} durationMS
 */
function recordMongoPoolCheckoutDuration (pool, durationMS) {
    if (typeof durationMS !== 'number' || !Number.isFinite(durationMS)) {
        return;
    }
    mongoPoolCheckoutDurationHistogram.record(durationMS / 1000, {
        [LABEL.POOL]: pool || UNKNOWN
    });
}

/**
 * Emit fhir_mongo_pool_checkout_failed_total, collapsing any reason outside the driver's
 * known set to UNKNOWN so label cardinality stays bounded.
 * @param {string} pool
 * @param {string} reason
 */
function recordMongoPoolCheckoutFailed (pool, reason) {
    const isKnownReason = Object.values(POOL_CHECKOUT_FAILURE_REASON).includes(reason);
    mongoPoolCheckoutFailedCounter.add(1, {
        [LABEL.POOL]: pool || UNKNOWN,
        [LABEL.REASON]: isKnownReason ? reason : UNKNOWN
    });
}

/**
 * Emit fhir_mongo_pool_cleared_total.
 * @param {string} pool
 */
function recordMongoPoolCleared (pool) {
    mongoPoolClearedCounter.add(1, { [LABEL.POOL]: pool || UNKNOWN });
}

/**
 * Emit fhir_mongo_pool_connection_created_total.
 * @param {string} pool
 */
function recordMongoPoolConnectionCreated (pool) {
    mongoPoolConnectionCreatedCounter.add(1, { [LABEL.POOL]: pool || UNKNOWN });
}

module.exports = {
    // Instruments — exported so integration tests can spy on `.add` / `.record`.
    mergeOutcomeCounter,
    validationFailureCounter,
    bundleSizeHistogram,
    everythingEmptyCounter,
    kafkaRetryExhaustedCounter,
    historyKafkaProducedCounter,
    historyKafkaFailedCounter,
    historyKafkaProduceDurationHistogram,
    historyMongoFallbackCounter,
    importOperationsTriggeredCounter,
    importResourcesProcessedCounter,
    importResourcesFailedCounter,
    importRangeDurationHistogram,
    importS3ReadThroughputHistogram,
    importFileSizeHistogram,
    importRangesCounter,
    importTasksCounter,
    importTaskDurationHistogram,
    kafkaConsumerGroupJoinsCounter,
    mongoPoolCheckoutDurationHistogram,
    mongoPoolCheckoutFailedCounter,
    mongoPoolClearedCounter,
    mongoPoolConnectionCreatedCounter,

    // Recording functions — production code calls these.
    recordMergeOutcomes,
    recordValidationFailure,
    recordInboundBundleSize,
    recordOutboundEverything,
    recordKafkaRetryExhausted,
    recordHistoryKafkaProduce,
    recordHistoryClickHouseRead,
    recordHistoryMongoFallback,
    recordImportOperationTriggered,
    recordImportResourceOutcomes,
    recordImportRangeDuration,
    recordImportS3ReadThroughput,
    recordImportFileSize,
    recordImportRanges,
    recordImportTaskFinished,
    recordKafkaConsumerGroupJoin,
    recordMongoPoolCheckoutDuration,
    recordMongoPoolCheckoutFailed,
    recordMongoPoolCleared,
    recordMongoPoolConnectionCreated,

    // Pure helpers — exported for direct unit testing.
    tallyMergeOutcomes,
    worstSeverity,

    // Label vocabularies.
    LABEL,
    OUTCOME,
    VALIDATION_STAGE,
    DIRECTION,
    OPERATION,
    SUBSYSTEM,
    PATH,
    POOL_CHECKOUT_FAILURE_REASON,
    IMPORT_RANGE_OUTCOME,
    IMPORT_TASK_STATUS,
    UNKNOWN
};
