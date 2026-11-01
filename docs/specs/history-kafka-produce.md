# Parallel history produce to Kafka

## Goal

Produce each history record to Kafka topic `fhir_server.resource-history.events`, one resource type
at a time, beside the unchanged MongoDB history write. This change only produces; what consumes the
topic is an independent workflow. Out of scope: Kafka-primary behaviour and the MongoDB fallback
replay job.

## Behaviour

- `KAFKA_HISTORY_RESOURCES` (comma-separated resource types) is the only switch. Empty (default) is
  off; a listed type produces; unlisted types behave as today. No separate kill switch.
- Requires the V2 Kafka cluster (`ENABLE_EVENTS_KAFKA_V2`); the disabled client would drop events.
- The MongoDB history write is never replaced, skipped or delayed. The produce runs after it, in
  the same post-request task (or in the background for the inline delete flush), and only when the
  write reported no error.
- Flags are read from the environment per call: changing the list is a config rollout, not a code
  change. There is no live reload without that rollout.
- A produce failure never fails the FHIR write and leaves MongoDB history in place.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `KAFKA_HISTORY_RESOURCES` | empty (off) | Resource types that produce |
| `KAFKA_HISTORY_EVENTS_TOPIC` | `fhir_server.resource-history.events` | Target topic |
| `HISTORY_KAFKA_BATCH_SIZE` | 50 | Messages per produce call; non-positive/non-numeric falls back to 50 |
| `KAFKA_PRODUCER_TIMEOUT_MS` | 10000 | Per-attempt produce timeout in ms (history and the AuditEvent ClickPipe path); non-positive/non-numeric falls back to 10000 |
| `KAFKA_PRODUCER_COMPRESSION` | `zstd` | Compression for history and the AuditEvent ClickPipe path (`none`/`gzip`/`zstd`) |

## Event

- Key: `<resourceType>:<_uuid>`.
- Body: a flat row, one top-level key per history table column: `resource_type`, `_uuid`, `_recorded`
  (stamped once when the entry is created, so retries carry the same value), `version_id`
  (`meta.versionId`), `access_tags` (codes of the access-system security tags) and `raw` (the
  history BundleEntry as written, including its `_recorded` stamp but without MongoDB's `_id`).
- CloudEvent binary mode headers: `ce_specversion=1.0`, `ce_type=FhirResourceHistory`,
  `ce_source=/fhir-server`, `ce_time=<_recorded ISO>`, `content-type=application/json`,
  `ce_id=uuid5(resourceType|_uuid|meta.versionId|_recorded ms)` using the repo's `generateUUIDv5`
  (OID namespace). Deterministic: replays of one version keep the id; versions written in the same
  millisecond differ.
- `traceparent` / `tracestate` are injected into the headers by `KafkaClientV2` (OpenTelemetry), as the event standard requires.
- Contract: `src/dataLayer/historyKafkaProducer.asyncapi.yaml` (update it with any change to the event).

## Hook points (every writer of history rows)

- `DatabaseBulkInserter` and `FastDatabaseBulkInserter`, in `performBulkForResourceTypeAsync`, when
  `useHistoryCollection === true`, only for types in the allowlist. When the flush runs inline in a
  request (delete, via `executeHistoryAsync`) the produce runs in the background (tracked by
  `HistoryKafkaProducer`, never awaited by the request) and is drained by `flushAsync()` during
  graceful shutdown, so Kafka latency never delays the request and no produce is lost on SIGTERM.
- `DatabaseUpdateManager.postSaveAsync` (admin Person/Patient link/unlink), which writes history
  directly.

## Failure handling

- Per chunk: per-attempt timeout (10s, `KAFKA_PRODUCER_TIMEOUT_MS`), up to 3 retries with exponential backoff and jitter.
- A chunk-specific broker rejection (`MESSAGE_TOO_LARGE`, `RECORD_LIST_TOO_LARGE`,
  `INVALID_RECORD`) is not retried; the chunk is resent record by record so only the bad record fails.
- A timed-out send is not retried (it is not cancelled and may still deliver); consumers dedupe on
  `ce_id`.
- Records that still fail are logged and counted (`fhir_history_kafka_produce_failed_total`) and
  remain in the MongoDB history. There is no dead-letter topic: this is a producer only.

## Observability

- Metrics by `resource_type`: `fhir_history_kafka_produced_total`,
  `fhir_history_kafka_produce_failed_total`, `fhir_history_kafka_produce_duration_seconds`.
- Structured logs carry resource type, counts, topic and request id only (no payloads, no PHI).

## Constraints

- Tenancy: no new query path; the produce reuses documents already built for the MongoDB history
  write.
- PHI: `raw` is the history BundleEntry (PHI, same as MongoDB); logs and metric labels never
  carry it.

## Testing

- Unit: producer (allowlist off/one/two types, batching, retries, timeout, chunk isolation,
  `ce_id`, batch-size validation) and the hook on both inserters (order, background defer, skip on error, skip when not enabled),
  `produceInBackground`/`flushAsync`.
- Integration (`src/tests/integration/dataLayer/databaseBulkInserter/historyKafkaProduce.test.js`):
  flag off, one type, two types, Kafka down, and the `postSaveAsync` writer; synthetic data only.
- Not done: dev-environment verification (consume the topic; confirm events, headers, compression,
  size under 17 MB; disable and confirm no new events).
