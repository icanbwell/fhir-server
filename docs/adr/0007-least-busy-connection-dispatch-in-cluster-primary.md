---
status: proposed
date: 2026-11-25
---

# Least-busy connection dispatch in the cluster primary

## Context and Problem Statement

Each fhir-server pod runs Node in cluster mode with `WORKER_COUNT` workers (6 in production). By
default Node's primary accepts every connection and hands it to the workers in turn
(round-robin), whatever each worker is doing.

traefik-internal runs with `--serversTransport.maxIdleConnsPerHost=-1`, which turns off backend
keep-alive. That is deliberate: it spreads requests evenly across pods that run on spot instances,
and it will not change. So most requests arrive on their own connection. In Groundcover on
2026-11-25, traefik-internal opened 0.6 to 0.84 new connections per request to the fhir
deployments, about 1.3 million an hour for fhir-server-pipeline alone.

Round-robin therefore already picks a worker for almost every request, and request counts per
worker are even (busiest worker 1.01 to 1.16 times the pod mean). Request time is not: the
busiest worker carries 2.1 times the mean in fhir-server-internal and about 1.4 times in
fhir-server-everything and fhir-server. One CPU-heavy request (bundle serialization, schema
validation, a large `$everything`) blocks a worker's event loop, and round-robin keeps handing
that worker every Nth new request, which waits behind it.

How should a pod spread requests across its workers by load?

## Decision Drivers

- Requests must go to a worker that can start on them now, not wait behind a blocked event loop.
- The traefik-internal setting stays as it is.
- No new stack component or vendor (no approved-tech registry entry or Tech Design Doc needed).
- Graceful shutdown on spot interruption keeps working: no request is dropped while the pod
  drains, and every worker still flushes its buffers.
- It can be turned on for one deployment at a time and off again without a code change.

## Considered Options

1. Least-busy dispatch in the cluster primary.
2. `NODE_CLUSTER_SCHED_POLICY=none`: workers accept connections from a shared socket themselves.
3. `SO_REUSEPORT`: each worker listens on its own socket and the kernel spreads connections.
4. A proxy sidecar in the pod (Envoy `least_request` or HAProxy `leastconn`), one port per worker.
5. One worker per pod, leaving balancing to Traefik.
6. An npm package.

## Decision Outcome

Chosen option: **1, least-busy dispatch in the cluster primary**, behind
`CLUSTER_SCHEDULING=least_busy`. The default stays `round_robin`, which is Node's scheduler,
unchanged.

How it works:

- The primary listens on the service port with `net.createServer({ pauseOnConnect: true })`. For
  each connection it picks a worker and sends the paused socket over IPC
  (`worker.send(message, socket)`), the same mechanism Node's round-robin uses
  (`src/utils/cluster/connectionDispatcher.js`).
- Each worker takes sockets from IPC into its HTTP server (`server.emit('connection', socket)`)
  and sends a load report every `CLUSTER_LOAD_REPORT_INTERVAL_MS` (default 25 ms): in-flight
  requests and connections received so far (`src/utils/cluster/workerLoadReporter.js`).
- The primary scores each worker and picks the lowest score, with ties broken at random
  (`src/utils/cluster/workerLoadTable.js`):

    ```text
    score = in-flight requests (last report)
          + connections sent to the worker that it had not received at its last report
          + max(0, time since last report - report interval) / CLUSTER_BLOCKED_MS_PER_REQUEST
    ```

    - The second term changes on every dispatch, so a burst of connections between two reports
      spreads out instead of all going to the worker that looked idle last time.
    - The third term catches a worker that is blocked right now: it cannot send its report, so the
      report goes overdue and the score rises for as long as the block lasts.

- A worker gets connections only after its first report, which it sends once its server is up,
  and none after it reports draining.
- A worker reports draining when Terminus' shutdown delay (`SHUTDOWN_DELAY_MS`) ends, not when
  SIGTERM arrives. During the delay the endpoint is still in Traefik's list, and every worker in
  the pod receives SIGTERM at the same moment. Marking them draining on the signal would leave the
  pod with no worker to send traffic to.
- In this mode each worker's HTTP server listens on a private loopback port (`127.0.0.1:0`,
  `exclusive`) that nothing connects to. Terminus' shutdown calls `server.close()`, which fails on
  a server that is not listening and would skip the buffer flush.
- The primary closes its listener after the last worker exits during shutdown, so it exits as it
  does today.

### Consequences

- Good: in a local test with 6 workers, 60 requests/s, one connection per request and 25% of
  requests holding the CPU for 150 ms, p90 for the fast requests fell from 66 ms to 1 to 2 ms and
  p99 from about 100 ms to 6 to 9 ms. No errors, under either policy.
- Good: the primary no longer sends work to a worker that is starting, draining or has lost its
  IPC channel. Round-robin hands work to any worker the cluster module lists.
- Good: no new dependency or component. About 300 lines in four small modules, each with unit
  tests.
- Bad: the primary does more per connection than Node's round-robin (a score over N workers,
  O(6)), and it handles about 40 load reports a second per worker. Both are small next to the
  socket hand-off, which round-robin also does. The primary must not take on other per-connection
  work.
- Bad: we own the scheduling code instead of relying on Node's.
- Neutral: a connection that carries several requests (a cluster-local caller with keep-alive)
  stays on one worker, as with round-robin. With traefik-internal that is rare.
- Neutral: the choice is made per connection; nothing moves a request that is already waiting.

### Confirmation

- Unit tests: `src/tests/unit/utils/cluster/` (selection, overdue reports, draining, invalid
  reports, IPC failures, config validation) and `src/tests/unit/utils/metrics.test.js`.
- Before rolling out, turn it on for one deployment (fhir-server-internal has the widest spread)
  and compare per-worker request time in Groundcover with round-robin:
  `sum by (process_pid) (rate(http_server_request_duration_seconds_sum[5m]))` against the pod
  mean, along with p95/p99 latency. The primary's own metrics:
    - `fhir_cluster_connections_dispatched_total`
    - `fhir_cluster_connections_dropped_total{reason}`: `no_worker` is expected only around start
      and the end of shutdown.
    - `fhir_cluster_dispatch_worker_score`: the score of the worker picked. A rising value means
      every worker in the pod is busy.

## Pros and Cons of the Options

### 1. Least-busy dispatch in the cluster primary

- Good: decides per connection, which here is nearly per request, using live load.
- Good: plain Node; turned on and off per deployment with an env var.
- Bad: custom code in the request path, and the primary must stay light.

### 2. `NODE_CLUSTER_SCHED_POLICY=none`

- Good: a worker with a blocked event loop stops accepting, so it gets no new connections while
  blocked.
- Bad: Linux tends to wake the same few workers, so connections pile onto one or two workers
  under light and medium load. Node moved away from this default for that reason.
- Bad: no view of in-flight work; an awake worker with many slow requests still accepts.

### 3. `SO_REUSEPORT`

- Bad: the kernel picks a worker by hashing the connection, so load plays no part. A blocked
  worker's accept queue keeps filling while others sit idle.

### 4. A proxy sidecar (Envoy or HAProxy)

- Good: truly per request, with per-worker health checks and retries.
- Bad: a new stack component (approved-tech registry entry and Tech Design Doc), an extra
  container per pod, 0.2 to 1 ms added latency, and buffering to turn off for streamed responses.

### 5. One worker per pod

- Good: no in-pod balancing at all.
- Bad: six times the pods for the same CPU, each with its own MongoDB, Kafka and ClickHouse
  clients; it multiplies connection counts and pod start-up cost.

### 6. An npm package

- Bad: none was found. PM2, throng and recluster use Node's round-robin. `@socket.io/sticky` and
  `sticky-session` pass sockets from the primary but pin by client address, not load.
  `poolifier` balances jobs sent as messages, not HTTP connections.

## More Information

- The default policy is unchanged, so nothing changes until a deployment sets
  `CLUSTER_SCHEDULING=least_busy`.
- Settings: `CLUSTER_SCHEDULING` (`round_robin` | `least_busy`), `CLUSTER_LOAD_REPORT_INTERVAL_MS`
  (default 25), `CLUSTER_BLOCKED_MS_PER_REQUEST` (default 10). An invalid value stops start-up.
- Related: the shutdown timing in `src/server.js` (`SHUTDOWN_DELAY_MS`, `GRACEFUL_TIMEOUT_MS`)
  and the Helm `preStop` hook in bwell-fhir-server.
