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
    PATH: 'path'
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

// Distinguishes save-time validation (POST/PUT/$merge) from validate-time
// validation ($validate). Same instrument, different label values.
const PATH = Object.freeze({
    SAVE: 'save',
    VALIDATE: 'validate'
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

module.exports = {
    // Instruments — exported so integration tests can spy on `.add` / `.record`.
    mergeOutcomeCounter,
    validationFailureCounter,
    bundleSizeHistogram,
    everythingEmptyCounter,
    kafkaRetryExhaustedCounter,
    importOperationsTriggeredCounter,
    importResourcesProcessedCounter,
    importResourcesFailedCounter,
    importRangeDurationHistogram,
    importS3ReadThroughputHistogram,
    importFileSizeHistogram,

    // Recording functions — production code calls these.
    recordMergeOutcomes,
    recordValidationFailure,
    recordInboundBundleSize,
    recordOutboundEverything,
    recordKafkaRetryExhausted,
    recordImportOperationTriggered,
    recordImportResourceOutcomes,
    recordImportRangeDuration,
    recordImportS3ReadThroughput,
    recordImportFileSize,

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
    UNKNOWN
};
