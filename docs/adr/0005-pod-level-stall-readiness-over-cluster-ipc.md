# Pod-Level Stall Readiness Aggregated Over Cluster IPC

## Status

Proposed

## Context and Problem Statement

fhir-server runs in Node cluster mode (`src/index.js`, `WORKER_COUNT=6` in prod). In INC-357 one
worker's Mongo pool was exhausted. Its requests hung until the 120s router timeout while the pod
stayed Ready for two hours and kept its share of traffic.

`/ready` checked only the per-worker request counter (`NO_OF_REQUESTS_PER_POD_REDINESS_CHECK`) and
memory (`ENABLE_MEMORY_CHECK`). Neither was set for fhir-server-internal, so `/ready` always passed.
And whichever worker accepted the probe connection answered it, so a healthy worker could not see a
sibling that had wedged.

We want `/ready` to fail when a meaningful share of the pod's recent requests are stalled, with the
same answer whichever worker takes the probe, and without pulling every pod when Mongo slows down
for the whole fleet.

## Decision Drivers

- The answer must reflect the whole pod, not the worker that took the probe.
- Hung requests never complete, so the signal must count in-flight requests, not only completions.
- A fleet-wide upstream slowdown must not take every pod out of rotation.
- No new infrastructure or dependency, no behaviour change until Helm turns it on.
- Small, injectable parts with no module-level state.

## Considered Options

- **A. Per-worker check only.** Each worker evaluates its own requests.
- **B. Primary aggregates per-worker snapshots over cluster IPC.** Workers report counts every few
  seconds; the primary sums them, applies the policy, and sends the pod verdict back to every worker.
- **C. Shared state outside the process** (a file in the pod, Redis, or the primary serving the probe
  on its own port).
- **D. Latency-based readiness** (p95/p99 over a window).

## Decision Outcome

Chosen option: **B**, because it is the only option that gives a pod-level answer with no new
infrastructure. Node's cluster IPC is already there, the messages are a few integers every five
seconds, and the primary already owns worker lifecycle.

### Signal

`stalled / total > maxStalledRatio`, with `total >= minSamples`, where for the last `windowMs`:

- `total` is requests completed in the window plus requests in flight now;
- `stalled` is completions that took longer than `stallThresholdMs` plus in-flight requests already
  older than it.

`/live`, `/health` and `/ready` are not tracked. Requests rejected with 429 are not tracked.

### Defaults (all off until `READINESS_STALL_CHECK_ENABLED=true`)

| Env var | Default | Meaning |
| --- | --- | --- |
| `READINESS_STALL_CHECK_ENABLED` | `false` | Turns the check on |
| `READINESS_STALL_THRESHOLD_MS` | `30000` | A request running longer than this is stalled |
| `READINESS_STALL_WINDOW_MS` | `120000` | How far back completed requests count |
| `READINESS_STALL_MAX_RATIO` | `0.2` | Fail when more than this share is stalled (0 to 1, exclusive) |
| `READINESS_STALL_MIN_SAMPLES` | `20` | Never fail with fewer requests than this in the window |
| `READINESS_STALL_REPORT_INTERVAL_MS` | `5000` | Worker to primary report interval; reports and verdicts older than 3 intervals are ignored |

### Why 20% catches one wedged worker

With `N` workers taking traffic evenly at total rate `r`, one worker hanging every request until
the 120s router timeout, and the defaults above, over the 2-minute window:

- healthy completions: `r * (N-1)/N * 120`, none stalled;
- hung requests in flight: `r/N * 120`, of which the ones older than 30s (`r/N * 90`) are stalled;
- hung requests that hit the router timeout inside the window: `r/N * 120`, all stalled.

So the stalled share is `(90 + 120) / (120 * (N + 1))`: about 25% with `WORKER_COUNT=6`, 22% with 7,
19% with 8. For more than 6 workers, lower `READINESS_STALL_MAX_RATIO` (0.15 covers up to 10).

### Fleet-wide slowdown safeguard

- The threshold is a stall (30s against sub-second normal latency), not a latency percentile, so a
  slowdown that leaves requests slow but finishing never trips it (rules out D).
- The ratio is the share of this pod's own requests, so one wedged worker on one pod pulls that pod
  only.
- `minSamples` keeps a quiet pod with a few slow requests Ready.
- Residual risk: an upstream outage that makes more than 20% of every pod's requests run past 30s
  will fail readiness fleet-wide. At that point those requests are already failing at the router.
  The Kubernetes probe `failureThreshold` adds damping, and readiness only removes endpoints; it does
  not restart pods.

### Components (`src/utils/stallReadiness/`)

- `RequestStallTracker`: per-process timings in one-second ring buckets plus an in-flight map.
  Bounded memory. Stores no request data.
- `StallReadinessPolicy`: snapshot to verdict.
- `PodStallAggregator`: sums the latest report per worker, drops stale ones. Pure state.
- `PrimaryStallCoordinator`: binds the aggregator to `cluster` messages and exits, broadcasts the
  verdict.
- Verdict providers: `ClusterWorkerStallVerdictProvider` (reports, uses the pod verdict, falls back
  to its own snapshot if the verdict is stale), `LocalStallVerdictProvider` (single process),
  `DisabledStallVerdictProvider`.

Tracker and provider are registered in `createContainer`; `server.js` passes the provider to
`createReadinessCheck`; `index.js` attaches the coordinator in the primary.

### Consequences

- Good: pod-level, whichever worker takes the probe; catches hung requests before they complete;
  off by default.
- Good: each piece is testable alone; the cluster boundary is the only thing faked in tests.
- Bad: a worker whose event loop is fully blocked cannot report; after three intervals it drops out
  of the aggregate rather than counting as stalled. The INC-357 failure (pool exhaustion) leaves the
  event loop running, so it is covered; a blocked event loop is a liveness concern.
- Bad: one more IPC message type between primary and workers.

### Pros and Cons of the Other Options

- **A.** Simple, but the worker that answers is usually a healthy one, which is exactly the INC-357
  failure.
- **C.** A file or Redis adds shared mutable state and a new failure mode; Redis would be a new use of
  a datastore. Serving the probe from the primary changes the Helm probe port and makes the primary an
  HTTP server.
- **D.** Latency percentiles move with fleet-wide upstream latency, so they would pull every pod in a
  Mongo slowdown.

### Follow-ups

- Consecutive Mongo checkout timeouts per worker (owned by the worker self-exit change) can be added to the
  worker report as a second signal once it lands.
- An OpenTelemetry gauge for the pod stall share.
