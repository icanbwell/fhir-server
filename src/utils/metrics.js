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
        const sep = key.indexOf('|');
        const outcome = key.substring(0, sep);
        const resourceType = key.substring(sep + 1);
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

module.exports = {
    // Instruments — exported so integration tests can spy on `.add` / `.record`.
    mergeOutcomeCounter,
    validationFailureCounter,
    bundleSizeHistogram,
    everythingEmptyCounter,
    kafkaRetryExhaustedCounter,

    // Recording functions — production code calls these.
    recordMergeOutcomes,
    recordValidationFailure,
    recordInboundBundleSize,
    recordOutboundEverything,
    recordKafkaRetryExhausted,

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
