# Worker Self-Exit on Repeated MongoDB Checkout Timeouts

## Status

Accepted

## Context

A Node cluster worker whose primary MongoDB request-path pool is wedged (every pooled connection
pinned, for example by cursors that are never closed) cannot recover on its own. The cluster
primary in `src/index.js` only re-forks a worker when it exits, and a wedged worker never exits:
it keeps taking its share of requests and failing them. In one incident a single worker stayed in
that state for two hours.

`waitQueueTimeoutMS` makes a starved checkout fail with a `connectionCheckOutFailed` CMAP event of
reason `timeout` instead of hanging, but it does not recover the worker.

## Options considered

1. **Do nothing; rely on an external liveness probe.** The probe would need to know about the pool.
   A shallow probe passes because the process answers, and a deep probe that checks out a
   connection adds load to the pool it is checking and restarts the whole pod, not one worker.
2. **Clear or recreate the MongoClient in place.** In-flight cursors and operations hold the old
   pool, request-scoped state refers to it, and the driver is not designed for a client swap under
   load. Higher risk than a process restart.
3. **Self-exit after N consecutive checkout timeouts (chosen).** The worker drains through the
   existing terminus graceful shutdown and exits non-zero. The cluster primary re-forks it, or
   Kubernetes restarts the container in single-process mode.

## Decision

Track `connectionCheckOutFailed` (reason `timeout`) per server address on the primary request-path
pool only. When `MONGO_CHECKOUT_TIMEOUT_EXIT_THRESHOLD` timeouts in a row fall inside
`MONGO_CHECKOUT_TIMEOUT_EXIT_WINDOW_MS`, span at least `MONGO_CHECKOUT_TIMEOUT_EXIT_MIN_SPAN_MS`,
and no successful checkout on that address intervenes, the worker logs, increments
`fhir_mongo_checkout_timeout_self_exit_total{pool}`, sets `process.exitCode = 1` and sends itself
SIGTERM. A backstop timer forces `exit(1)` if the drain hangs.

- The minimum span stops a burst of waiters that queued together behind busy but healthy
  connections from recycling a merely saturated worker.
- Background pools (audit-event, online-archive, access-logs, resource-history) are not tracked: a
  saturated background pool is not a wedged request path.
- Setting the threshold to `0` disables the feature without a code deploy. The kill switch is an
  environment variable, so it takes effect through a pod rollout, not a hot toggle.

## Consequences

- A wedged worker is replaced within roughly the window plus the graceful drain.
- If Mongo saturates every worker at once, several can recycle together. The consecutive-run and
  minimum-span requirements limit this, and the self-exit counter makes it visible. Each recycling
  worker drains for the shutdown delay plus the graceful timeout (about 44s with the defaults)
  before it exits, and its replacement starts with cold connection pools.
- A worker needs at least `MONGO_CHECKOUT_TIMEOUT_EXIT_THRESHOLD` timeouts inside the window, so a
  wedged worker that receives very little traffic will not recycle. This is accepted: a worker
  that is not failing requests is not hurting clients.
- `GRACEFUL_TIMEOUT_MS` and `SHUTDOWN_DELAY_MS` are parsed as digits only and an invalid value
  fails startup, instead of the earlier `parseInt` behavior that accepted values like `29s`.
- In single-process mode the exit restarts the container, and the pod's restart count rises.
- The feature does nothing unless `waitQueueTimeoutMS` is set, because the driver emits no
  `timeout` failure without it.
