# Observability Emission Pattern: Ambient Module + Boundary Choke Points

## Status

Proposed (replaces a previous draft of this ADR that prescribed strict DI for the meter)

**Scope notes:**
- This ADR establishes the pattern for application-domain custom metrics in fhir-server. It does not change auto-instrumentation, tracing, or the existing OpenTelemetry SDK setup in `src/otel_instrumentation.js`.
- The first set of instruments is the EA-2240 group: merge outcome, validation failure, bundle size, empty `$everything`, and Kafka retry exhaustion. Future custom metrics in this repo follow the pattern documented here.
- A previous draft of this ADR prescribed strict DI of a typed `CustomMetrics` class injected into every consumer. That implementation produced three rounds of review-caught bugs of two shapes: (1) constructor-cascade test breakage every time a new consumer required `customMetrics`, and (2) edge-path bugs scattered across the 13 emission sites where every consumer shared responsibility for partitioning correctly. This ADR documents why we are not doing that, and what we are doing instead.

## Context

Per AGENTS.md "Observability Is a Deliverable," services need meaningful application-domain metrics. The OpenTelemetry SDK is already wired (`src/otel_instrumentation.js`), with a metric exporter and reader configured. What's missing is custom application-domain instruments and the pattern for adding them.

EA-2240 introduces five instruments to surface failure modes on the FHIR server's write and read paths. The shape of this work establishes a pattern that will repeat as custom metrics are added across the codebase.

### What didn't work: strict DI of a `CustomMetrics` class

The first attempt registered `CustomMetrics` as a container service and injected it via constructor into every consumer that emitted (`MergeOperation`, `ResourceValidator`, `BundleResourceValidator`, `NdjsonParser`, `EverythingHelper`, `KafkaClient`). Every consumer asserted `assertTypeEquals(customMetrics, CustomMetrics)` to enforce DI hygiene.

Two problem patterns emerged across three review rounds:

**Constructor cascade.** Every test file that constructed one of those consumers (or a mock that extended one) had to be updated to pass `customMetrics`. Round 2 caught one broken test file; round 3 caught four more. Each round, the author fixed the file the round flagged and shipped. The next round found different files broken by the same root cause. There is no way to stop this empirically — every constructor change recurs the problem.

**Scatter of emission sites.** The "no helper wrappers" rule meant emission code lived at every call site (13 of them). Each call site was independently responsible for partitioning entries correctly, computing the right label set, and not double-counting against other call sites. Round 1 found the streaming N-count bug (cumulative list passed to per-batch tally). Round 2 found that the streaming pre-check and merge-error pushes bypassed `insertAndLog`'s tally entirely. Round 3 found that the Bundle-400 path passes an `OperationOutcome`, not a `MergeResultEntry`, into the tally. Each finding was a different edge path missed at a different scattered site.

Both problems trace to the same design choice: pretending the OTel meter is a domain dependency that should flow through DI. It isn't. It's an ambient platform-level concern, like the logger.

### What AGENTS.md says, read carefully

> **No Hidden Global State.** All dependencies must be explicit and injectable. No module-level singletons that hold state. No implicit service locators.

This rule is correct as a default but has a deliberate exception:

> **Observability Is a Deliverable.** OpenTelemetry tracing propagation must be maintained across service boundaries. Trace context must flow through Kafka headers, HTTP headers, and any other transport. Logs must be structured (JSON) with correlation IDs. Metrics must be meaningful, not just counters.

The OTel meter provider is process-wide ambient by construction. The OTel SDK explicitly initializes a global meter provider; `metrics.getMeter(name)` returns a meter bound to that provider. Forcing this through typed DI fights the grain of the platform. Logging and metrics are the canonical cross-cutting concerns where strict DI costs more than it buys. This ADR documents that explicitly.

## Decision

**An ambient `metrics` module that owns the OTel meter, exports named recording functions, and is called from a small set of domain-boundary choke points. Five emission sites total, not thirteen.**

### Architecture

```javascript
// src/utils/metrics.js
'use strict';
const { metrics } = require('@opentelemetry/api');

const meter = metrics.getMeter('fhir-server');

const mergeOutcomeCounter = meter.createCounter('fhir_merge_outcome_total', { /* ... */ });
const validationFailureCounter = meter.createCounter('fhir_validation_failure_total', { /* ... */ });
const bundleSizeHistogram = meter.createHistogram('fhir_bundle_size_entries', {
    unit: '1',
    advice: { explicitBucketBoundaries: [1, 10, 50, 100, 500, 1000, 5000, 10000, 50000] }
});
const everythingEmptyCounter = meter.createCounter('fhir_everything_empty_total', { /* ... */ });
const kafkaRetryExhaustedCounter = meter.createCounter('fhir_kafka_retry_exhausted_total', { /* ... */ });

// Public API: recording functions, one per domain event.
function recordMergeOutcomes(entries) { /* tally and emit */ }
function recordValidationFailure(operationOutcome, resourceType, validationStage, validationContext) { /* ... */ }
function recordInboundBundleSize(operation, length) { /* ... */ }
function recordOutboundEverything(resourceType, length) { /* records both bundle size and empty counter */ }
function recordKafkaRetryExhausted(topic, errorCode) { /* ... */ }

module.exports = {
    recordMergeOutcomes,
    recordValidationFailure,
    recordInboundBundleSize,
    recordOutboundEverything,
    recordKafkaRetryExhausted
};
```

Consumers `require('../utils/metrics')` and call the named function at the domain-event boundary. No constructor parameter. No `assertTypeEquals`. No DI registration.

### The five emission sites (boundary choke points)

Verified by walking the production code. Each site is a function-return point where every input the metric needs is in scope. **All boundary emissions are placed in `finally` blocks**, not after success returns, so abort and rethrow paths still emit. The two data-loss cases this protects are:

- **Streaming pipeline abort.** `mergeAsyncStream` catches `AbortError` and falls through without rethrowing (current `merge.js:521`); placing the emission in `finally` (rather than after the catch) ensures it fires whether the pipeline succeeds, aborts, or throws-and-rethrows.
- **Non-streaming exception.** `mergeAsync`'s catch block rethrows after logging (current `merge.js:362`); a `finally` ensures partial-result emission for whatever made it into `mergeResults` before the throw.

| # | Site | File | Where | What it records |
|---|---|---|---|---|
| 1 | Non-streaming merge return | `src/operations/merge/merge.js` | `finally` block wrapping the `mergeAsync` try/catch — fires on both success-return and rethrow. `mergeResults` is in scope (declared at the top of the try) | `recordMergeOutcomes(mergeResults)` over the full result list — pre-check errors, mid-merge errors, bulk-write outcomes, and unchanged placeholders are all concatenated in this list. Confirmed by walking the four push paths in the streaming Transform (lines 427, 446, 572, 588) — all push to `finalMergeResults` so the single emission post-pipeline is a complete superset |
| 2 | Streaming merge pipeline completion | `src/operations/merge/merge.js` | `finally` block wrapping `executeMerge`'s `await pipeline(...)` — fires on success, abort, and rethrow. `finalMergeResults` is closed over in `executeMerge` scope | `recordMergeOutcomes(finalMergeResults)` once. Replaces the four scattered emission sites the previous design had inside the streaming Transform |
| 3 | Validation completion | `src/operations/common/resourceValidator.js` | At the existing single return point of `validateResourceAsync` (and an analogous point in `validateResourceMetaSync`) when the outcome is non-null. No `finally` needed — the function only emits when there's an outcome to emit | `recordValidationFailure(outcome, resourceType, stage, context)` where `context` is `'save'` (default) or `'validate'` (passed from `/$validate`) |
| 4 | `$everything` success return | `src/operations/everything/everythingHelper.js` | At the success-return of `retriveEverythingAsync`, after `bundle` is built and `streamedResources` is final. Two-mode discrimination handled inline via the existing pattern at line 362: `const entryLength = responseStreamer ? streamedResources.length : (bundle.entry?.length ?? 0)` | `recordOutboundEverything(resourceType, entryLength)` — internally records both the size histogram and (if `entryLength === 0`) the empty counter. Single call site, both modes covered |
| 5 | Kafka retry-loop exhaustion | `src/utils/kafkaClient.js` | After both retry loops in `sendMessagesAsync` and `sendCloudEventMessageAsync`, when the loop exits with `shouldRetry === true` | `recordKafkaRetryExhausted(topic, errorCode)` |

Inbound bundle size has two sub-sites because they're genuinely different operations:

| # | Site | File | Where |
|---|---|---|---|
| 6a | Inbound merge bundle | `src/operations/merge/merge.js` | At the start of `mergeAsync` once `incomingObjects` is parsed, before any merging starts. Records `recordInboundBundleSize('merge', incomingObjects.length)` |
| 6b | Inbound NDJSON | `src/operations/merge/merge.js` | In the same `finally` block as site 2, using a counter that the `mergeTransform` increments on every `transform()` invocation. Pipeline aborts and exceptions still see the partial count because `transform()` invocations have already mutated the counter before the pipeline rejects. **The NdjsonParser does NOT emit. The count is observed at the merge boundary.** Aborts and partial loads are visible by construction *because* the emission is in a `finally`, not because of a magic property of the boundary. The ADR previously claimed "by construction" without naming the `finally` — corrected here |

That's six call sites across four files. Sites 1 and 6a colocate inside `mergeAsync`'s `finally`; sites 2 and 6b colocate inside `executeMerge`'s `finally`. Functionally, this is **four files touched, six call lines added**. Compare to the previous design's 13 call sites across 7 files, plus 5 constructor parameter additions plus 5 DI registration changes.

#### Disjointness invariant (replaces the prior design's three-source disjointness)

The previous design had to argue that three disjoint sources (pre-check errors, mid-merge errors, bulk-write outcomes, and placeholders) were tallied at three or four scattered sites without overlap. The new design has **one list, one tally**: `finalMergeResults` (streaming) or `mergeResults` (non-streaming). The disjointness invariant degrades from "three sites must agree on partition" to "the list must contain each resource exactly once." Empirical evidence the latter holds: walking `merge.js` at the four push sites (427, 446, 572, 588) confirms the four sources of entries are themselves disjoint by UUID (Sets enforce this at lines 568 and 577). One emission over the whole list = one increment per resource.

### Test seam

Two layers, picked to defeat the destructured-import footgun that breaks naive `jest.spyOn(module, 'fn')` patterns.

**Layer 1 — pure logic tests.** The recording functions decompose into pure helpers (`tallyMergeOutcomes(entries) -> Map<labelKey, count>`, `worstSeverity(operationOutcome) -> 'error'|'warning'|null`, etc.). Tests call these helpers directly with input data, assert on the returned tally. No spying, no module mocking, no jest gymnastics. This is where the math correctness lives — the streaming-N-count regression test, per-resource-not-per-issue, worst-severity ranking, Bundle-400 guard. Pure functions are the right test seam for pure logic.

**Layer 2 — integration tests on the OTel instruments themselves.** Tests spy on `mergeOutcomeCounter.add` (the OTel counter exported from `metrics.js`), not on the recording function. The counter is a property of the module's exports; spying on it survives any import style at the call site:

```javascript
const metrics = require('../../utils/metrics');

test('non-streaming merge fires outcome counter once per resource', async () => {
    const spy = jest.spyOn(metrics.mergeOutcomeCounter, 'add');
    // ... real HTTP request through createTestRequest ...
    expect(spy).toHaveBeenCalledWith(
        expect.any(Number),
        expect.objectContaining({ outcome: 'created', resource_type: 'Patient' })
    );
});
```

This works whether the call site does `const { recordMergeOutcomes } = require('../utils/metrics')` and calls it bare, or `metrics.recordMergeOutcomes(...)` namespaced — the counter is the actual OTel API call, downstream of any import indirection. Tests assert on what production actually does to OTel.

**Why not `jest.spyOn(metricsModule, 'recordMergeOutcomes')`.** It only intercepts if the call site uses namespace access (`metrics.recordMergeOutcomes(...)`). Destructured imports (`const { recordMergeOutcomes } = require('../utils/metrics')`) bind the reference at import time and bypass the spy entirely. Tests would silently false-green: spy never called, assertion fails, test author "fixes" the call style or assumes a logic bug, real bug ships. The codebase's standard idiom is destructured imports, so this footgun is loud.

**The rule for emission sites.** Either is fine for the import style — destructured or namespaced — because tests don't depend on it. The constraint is:
- Pure logic tested via direct calls to exported helpers (no spy needed)
- Integration tested via spy on the OTel instrument (`mergeOutcomeCounter.add`, etc.)
- Never via spy on the recording wrapper function

This is an unusual pattern worth a comment in `metrics.js` explaining why it's the chosen seam.

### Removed by this design

- The `CustomMetrics` class as a DI service.
- `customMetrics` constructor parameter on every consumer (5 classes).
- `assertTypeEquals(customMetrics, CustomMetrics)` calls (5 sites).
- `customMetrics` registration in `createContainer.js` and the cascade of inject lines (`mergeOperation`, `resourceValidator`, `everythingHelper`, `bundleResourceValidator`, `kafkaClient`).
- Per-call-site label-key dictionary lookups (`{ [LABEL.OUTCOME]: outcome }`). Inline label objects are fine when there's only one place that emits each metric.
- The `MockKafkaClient` cascade fix and the broken-by-PR test files (`app.test.js`, `kafkaClientConfig.test.js`, etc.). They never break because nothing was added to the constructor.

### What survives from the prior implementation

- Instrument names, descriptions, and bucket boundaries (frozen contract; metric names are public and shouldn't change).
- The label vocabulary: `outcome`, `resource_type`, `validation_stage`, `severity`, `path` (new — for save vs validate), `direction`, `operation`, `topic`, `error_code`, `subsystem`.
- The `recordMergeOutcomes` tally logic (per-resource, per-window, with the disjointness guarantee at the call sites).
- `worstSeverity` helper.
- Histogram bucket boundaries (`[1, 10, 50, 100, 500, 1000, 5000, 10000, 50000]`).
- The empty-`$everything` counter design.
- The Bundle-400 defensive guard inside `recordMergeOutcomes` (skip entries where `resourceType === 'OperationOutcome'`).
- The validation-stage label including `'reference'`.
- The `path` label distinction (`save` vs `validate`) added in response to round 3's review.

These are pure data and logic. They get copied into the new module unchanged.

## Consequences

### Positive

1. **Constructor cascade is eliminated.** The pattern's empirical failure mode goes away.
2. **Emission scatter is reduced from 13 sites to 6.** Every emission goes through one of six call lines at four files. The label sets are inline at the call sites.
3. **Disjointness invariant is simpler.** The previous design needed three separate emission sites to agree on partition without overlap. The new design has one list, one tally, one increment per resource — the empirical failure mode of the prior design (round 1 streaming N-count, round 2 inline-bypass, round 3 Bundle-400 mislabel) doesn't have a place to land.
4. **Abort and exception paths emit by `finally`, not by hope.** The two data-loss cases (streaming abort, non-streaming rethrow) are explicitly handled with `finally` blocks around the boundary, not by relying on the success-return path always being reached.
5. **Test seam is two-layer:** pure-logic helpers tested directly (no spying), integration tested via `jest.spyOn` on the OTel instrument itself (survives destructured imports). Naive `jest.spyOn(module, 'fn')` would silently false-green and is documented as forbidden.
6. **PHI safety surface is smaller.** Reviewing six emission sites for label correctness is feasible. Reviewing 13 was feasible in theory and broken in practice.
7. **AGENTS.md no-global-state rule is honored at the right level.** The exception for observability is documented, not pretended away.

### Negative

1. **Module-level state.** `meter`, the five instruments, and the recording functions live at module scope. Reloading the module (e.g., in test isolation) reuses the global meter provider. In practice this is fine because tests don't load `otel_instrumentation.js`, so `metrics.getMeter` returns the no-op meter and there's no observable cross-test state. Production loads the real provider once at boot.
2. **Less explicit than DI.** A reader has to know that `require('../utils/metrics')` returns an ambient interface. Mitigated by the module being narrow (six exported functions) and the file having a header comment naming the pattern.
3. **Concrete coupling.** Consumers depend on the concrete `metrics` module, not an abstraction. Acceptable: the metric module IS the abstraction over OTel. A future swap (Datadog, custom backend) lives behind the same exported function names.

### Mitigations

- Module-scope state: documented at the top of `metrics.js` with the AGENTS.md observability-exception framing.
- Discoverability: the module exports a narrow API with descriptive names. JSDoc on every exported function names the metric, the labels, and the cardinality bounds.
- Concrete coupling: the function-name boundary is the abstraction. If we ever swap providers, the swap lives inside `metrics.js`.

## Options Considered

### Option 1: Strict DI of a typed `CustomMetrics` class (rejected — was the prior design)

**Pros:**
- Matches the rest of the codebase's DI conventions.
- Mockable via `Object.create(CustomMetrics.prototype)` patterns.
- Type assertions enforced at construction.

**Cons:**
- Constructor cascade: every consumer-creating test file breaks when a new consumer requires the metric. Three rounds of review caught this in different files; no review found all of them.
- 13 emission sites: scatter means edge paths are missed. Three rounds caught different scatter bugs (streaming N-count, pre-check inline bypass, Bundle-400 mislabel).
- Pretends an ambient platform concern is a domain dependency.

**Rejection reason:** empirical. The pattern fights the OTel meter's ambient nature, and the consequences shipped multiple times.

### Option 2: Ambient module, scattered call sites (rejected)

Drop the typed DI but keep the 13 call sites, just calling `metrics.add(counter, 1, labels)` at each site instead of `this.customMetrics.counter.add(...)`.

**Pros:**
- Eliminates the constructor cascade.
- Lighter syntax than typed DI.

**Cons:**
- Doesn't fix the scatter problem. The Bundle-400 mislabel and the streaming N-count bugs were not caused by DI — they were caused by 13 places needing to agree on what counts and what doesn't. Switching to ambient calls leaves 13 places.
- The user's review explicitly named this: "you still have 13 places to miss an edge path."

**Rejection reason:** addresses the test-pain symptom but not the production-correctness symptom.

### Option 3: Domain-event bus with metrics subscriber (rejected for now)

Have `MergeOperation` publish a `MergeCompleted` event with the outcomes list; a single metrics subscriber translates events to metric calls. Audit and provenance could subscribe to the same events.

**Pros:**
- Cleanest centralization. One subscriber owns all partition and label rules.
- Reuse-ready for audit/provenance.

**Cons:**
- New abstraction (in-process event bus) that doesn't exist in this repo.
- Awkward fit for infrastructure signals: Kafka retry exhaustion isn't a domain event of a merge — it's its own thing, lands outside the model or needs its own event type.
- More than the problem needs if metrics is the only consumer today.

**Rejection reason:** abstraction earns its keep when it has multiple consumers. Today, only metrics consumes these signals. If audit or provenance later need the same events, revisit and migrate the metrics subscriber to it. The current design doesn't preclude that future.

### Option 4: Ambient module emitting from boundary choke points (selected)

What this ADR documents. Ambient `metrics.js` module with named recording functions called from 5–6 boundary points where every input is in scope.

**Pros:**
- Eliminates constructor cascade (no DI thread).
- Eliminates scatter (5–6 sites, not 13).
- Centralizes partition rules at the boundary, where the full result list is in scope.
- Standard jest test seam.
- Matches AGENTS.md observability exception explicitly.

**Cons:**
- Module-level state (the meter and instruments). Acceptable because OTel is ambient by design and tests use the no-op meter.
- Concrete coupling to the `metrics` module name. The module IS the abstraction.

**Selection reason:** addresses both the test-pain and production-correctness failure modes with the minimum new abstraction.

## References

- AGENTS.md (icanbwell/.github): https://github.com/icanbwell/.github/blob/main/AGENTS.md (specifically "Observability Is a Deliverable" and the no-global-state rule)
- OpenTelemetry JS Metrics API: https://opentelemetry.io/docs/languages/js/instrumentation/#metrics
- EA-2240 (Jira): the first instruments built under this pattern
- EA-2226 (Jira): the dashboard ticket that consumes the resulting metrics
- Three review rounds on the prior design (constructor cascade and emission scatter): the empirical evidence for this redesign

## Related Decisions

- Future custom-metrics work in this repo follows this pattern.
- Cross-service trace correlation (EA-2263) and per-client header propagation (EA-2262) are platform-tier concerns, not application-tier custom metrics. They follow different patterns documented separately.

---

**Date**: 2026-06-05
**Authors**: Bill Field
**Status**: Proposed
