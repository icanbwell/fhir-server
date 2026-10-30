# Keep Kafka Consumers in Their Group While a Bulk Import Range Is Processed

## Status

Proposed (DCON-5984)

## Context

A prod `$import` of 56 files (2,052,058 resources, Task `93e7097e3584466aa0fb6512b232e278`, 2026-10-28)
took about 29 hours. `fhir-server-worker` members were repeatedly evicted from the
`fhir-bulk-import-consumer` group: kafkajs logged `The coordinator is not aware of this member` and
OffsetCommit failed with the same error. The batch each evicted member had fetched was redelivered and
its ranges were processed again (170 range runs for 56 files). The orchestrator also exited with
`Timeout bulk-import-range-progress`.

Three causes, all in how `KafkaClientV2` builds and runs consumers:

1. **No heartbeat during a handler.** kafkajs 2.2.4 has no background heartbeat. It heartbeats before
   `eachMessage` (our retry wrapper does so before each attempt) and after it returns. A range takes
   20-110 s and the session timeout is the default 30 s, so the broker evicts the member mid-range. The
   heartbeat after the handler then throws `UNKNOWN_MEMBER_ID`, the offset commit fails, and the message is
   redelivered.
2. **A rebalance mid-handler also evicts.** During a rebalance every member must rejoin within
   `rebalanceTimeout` (default 60 s). A member inside a handler cannot rejoin until it returns.
3. **The join wait is shorter than the rebalance.** `worker.js` and `orchestrator.js` wait 30 s for the
   first `GROUP_JOIN` and then `process.exit(1)`, but a join can take up to `rebalanceTimeout`.

## Options considered

### A. Background heartbeat timer in `KafkaClientV2`, plus longer rebalance and join timeouts (chosen)

Wrap each message's processing in a timer that calls kafkajs's `heartbeat()` every heartbeat interval,
make the three consumer timeouts configurable, and size the rebalance and join timeouts above the longest
handler. Covers every consumer and every handler, including retries and backoff, with no handler changes.

### B. Pass `heartbeat` into the bulk import handler's batch loop

Rejected. Any error thrown inside the range loop is caught in `handleImportRangeRequestedAsync` and
published as `ImportRangeFailed`, which fails the whole Task, so a heartbeat error after an eviction would
turn a recoverable redelivery into a failed import. It would also touch the handler and cover only the code
paths that call it (not the S3 output writes after the loop).

### C. Raise only `sessionTimeout`

Rejected. It does not fix cause 2 or 3, and it slows detection of genuinely dead members for every
consumer.

### D. Switch to `eachBatch` with `resolveOffset` and `heartbeat`

Rejected for now. It would also commit progress per message, but it is a larger rewrite of the consumer
wrapper (retry, dead-letter and failure counting are per message).

## Decision

Option A.

- `createConsumerAsync` passes `sessionTimeout` (30000), `heartbeatInterval` (3000) and
  `rebalanceTimeout` (300000), each overridable with `KAFKA_CONSUMER_SESSION_TIMEOUT_MS`,
  `KAFKA_CONSUMER_HEARTBEAT_INTERVAL_MS` and `KAFKA_CONSUMER_REBALANCE_TIMEOUT_MS`.
- `receiveMessagesAsync` sends a heartbeat on that interval while a message is processed. kafkajs sends at
  most one request per heartbeat interval, so extra ticks cost nothing. A failed background heartbeat is
  logged once per message and is never thrown into the handler. After an eviction the heartbeat kafkajs
  sends when the handler returns still throws, so the message is redelivered as before.
- The join wait is `KAFKA_CONSUMER_JOIN_TIMEOUT_MS` (default 330000, the rebalance timeout plus 30 s).

## Consequences

- A member that is alive and heartbeating is no longer evicted for a long handler, so ranges are
  processed once instead of once per eviction.
- A rebalance (for example a KEDA scale step) can now hold the whole group for up to the longest
  in-flight range, up to `rebalanceTimeout`, instead of evicting the busy member. Throughput during a
  rebalance drops, but no work is repeated. Scale-up policy is a separate follow-up.
- A handler stuck forever now keeps its member alive, because it still heartbeats. Handler duration is
  bounded by the handler's own timeouts, not by the session timeout.
- A pod that dies still loses its session after `sessionTimeout`, unchanged.
- Rollback: set the four environment variables back to 30000, 3000, 60000 and 30000.
- Not addressed here: the worker's skip check only sees a range after the orchestrator has applied its
  `ImportRangeCompleted`, so a redelivery after completion still reprocesses that range.
