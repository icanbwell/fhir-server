# Parallel history produce to Kafka

## Goal

Produce each history record to Kafka topic `fhir_server.resource-history.events`, one resource type
at a time, beside the unchanged MongoDB history write. Phase 1 of the history rollout: lets volume,
ClickPipes behaviour and cost be checked before widening. Out of scope: Kafka-primary behaviour,
the MongoDB fallback replay job, the ClickHouse table/pipe/backfill, reading `_history` from
ClickHouse. What consumes the topic is an independent workflow; this change only produces.

## Behaviour

- `KAFKA_HISTORY_RESOURCES` (comma-separated resource types) is the only switch. Empty (default) is
  off; a listed type produces; unlisted types behave as today. No separate kill switch.
- Requires the V2 Kafka cluster (`ENABLE_EVENTS_KAFKA_V2`); the disabled client would drop events.
- The MongoDB history write is never replaced, skipped or delayed. The produce runs after it, in
  the same post-request task, and only when the write reported no error.
- Flags are read from the environment per call: changing the list is a config rollout, not a code
  change. There is no live reload without that rollout.
- A produce failure never fails the FHIR write and leaves MongoDB history in place.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `KAFKA_HISTORY_RESOURCES` | empty (off) | Resource types that produce |
| `KAFKA_HISTORY_EVENTS_TOPIC` | `fhir_server.resource-history.events` | Target topic |
| `HISTORY_KAFKA_BATCH_SIZE` | 50 | Messages per produce call; non-positive/non-numeric falls back to 50 |
| `AUDIT_EVENT_CLICKPIPE_COMPRESSION` | `zstd` | Reused for compression (`none`/`gzip`/`zstd`) |

## Event

- Key: `<resourceType>:<_uuid>`.
- Body: the history document, including `_recorded` (stamped once when the entry is created, so
  retries carry the same value).
- CloudEvent binary mode headers: `ce_specversion=1.0`, `ce_type=ResourceHistoryRecorded`,
  `ce_source=fhir-server`, `ce_time=<_recorded ISO>`, `ce_datacontenttype=application/json`,
  `ce_id=uuid5(resourceType|_uuid|meta.versionId|_recorded ms)` using the repo's `generateUUIDv5`
  (OID namespace). Deterministic: replays of one version keep the id; versions written in the same
  millisecond differ.
- Trace context is injected into headers by `KafkaClientV2`.

## Hook points (every writer of history rows)

- `DatabaseBulkInserter` and `FastDatabaseBulkInserter`, in `performBulkForResourceTypeAsync`, when
  `useHistoryCollection === true`. When the flush runs inline in a request (delete, via
  `executeHistoryAsync`) the produce is queued on `postRequestProcessor`, so Kafka latency never
  delays the request.
- `DatabaseUpdateManager.postSaveAsync` (admin Person/Patient link/unlink), which writes history
  directly.

## Failure handling

- Per chunk: per-attempt timeout (30s), up to 3 retries with exponential backoff and jitter.
- A chunk-specific broker rejection (`MESSAGE_TOO_LARGE`, `RECORD_LIST_TOO_LARGE`,
  `INVALID_RECORD`) is not retried; the chunk is resent record by record so only the bad record fails.
- A timed-out send is not retried (it is not cancelled and may still deliver); consumers dedupe on
  `ce_id`.
- Records that still fail go to `<topic>.dlq`: ids and error metadata only (`resourceType`, `uuid`,
  `sourceTopic`, `errorType`, `error`, `failedAt`), never the resource. They can be reconciled
  against MongoDB history. A failing DLQ publish is logged and swallowed.

## Observability

- Metrics by `resource_type`: `fhir_history_kafka_produced_total`,
  `fhir_history_kafka_produce_failed_total`, `fhir_history_kafka_produce_duration_seconds`.
- Structured logs carry resource type, counts, topic and request id only (no payloads, no PHI).

## Constraints

- Tenancy: no new query path; the produce reuses documents already built for the MongoDB history
  write. Tenant is not in the partition key (the ticket specifies `resourceType:_uuid`); the org
  Kafka standard prefers `tenant:<id>:<entity>:<id>`, so this needs EA/TDD confirmation.
- PHI: payload is the history document (PHI, same as MongoDB); logs, metric labels and DLQ never
  carry it.
- Event contract: `ce_type` `ResourceHistoryRecorded` and the `.dlq` topic /
  `ResourceHistoryRecordFailed` type are new. No AsyncAPI contract for events exists in this repo
  (only `src/operations/export/asyncapi.yaml`), so they must be recorded in the TDD/AsyncAPI.
- Flag names differ from TDD 7.1 (`ENABLE_HISTORY_KAFKA`, `CLICKHOUSE_HISTORY_RESOURCES`).

## Testing

- Unit: producer (allowlist off/one/two types, batching, retries, timeout, chunk isolation, DLQ,
  `ce_id`, batch-size validation) and the hook on both inserters (order, defer, skip on error).
- Integration (`src/tests/integration/dataLayer/databaseBulkInserter/historyKafkaProduce.test.js`):
  flag off, one type, two types, Kafka down, and the `postSaveAsync` writer; synthetic data only.
- Not done: dev-environment verification (consume the topic; confirm events, headers, compression,
  size under 17 MB; disable and confirm no new events).
