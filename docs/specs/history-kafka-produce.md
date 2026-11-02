# Parallel history produce to Kafka

## Goal

Produce each history record to Kafka topic `fhir_server.resource-history.events`, one resource type
at a time, beside the unchanged MongoDB history write. This change only produces; what consumes the
topic is an independent workflow. Out of scope: Kafka-primary behaviour and the MongoDB fallback
replay job.

## Consumer table

The topic is loaded into ClickHouse table `fhir.Resource_4_0_0_History`
(`clickhouse-init/08-resource-history.sql`, see `readme/clickhouse.md`). It is a
`ReplacingMergeTree` keyed on `(resource_type, _uuid, _recorded, version_id)`, partitioned by month,
with a 13-month TTL. Duplicate deliveries collapse on that key, which is why consumers dedupe
rather than this producer. The loader and the `_history` read path are separate work.

## Behaviour

- `RESOURCE_HISTORY_KAFKA_RESOURCES` (comma-separated resource types) is the only switch. Empty (default) is
  off; a listed type produces; unlisted types behave as today. No separate kill switch.
- Requires the V2 Kafka cluster (`ENABLE_EVENTS_KAFKA_V2`); the disabled client would drop events.
- The MongoDB history write is never replaced, skipped or delayed. The produce runs after it, in
  the same post-request task (inline for delete), and only when the
  write reported no error.
- Flags are read from the environment per call: changing the list is a config rollout, not a code
  change. There is no live reload without that rollout.
- A produce failure never fails the FHIR write and leaves MongoDB history in place.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `RESOURCE_HISTORY_KAFKA_RESOURCES` | empty (off) | Resource types that produce |
| `RESOURCE_HISTORY_MONGO_DISABLED_RESOURCES` | empty (off) | Resource types whose MongoDB history write is replaced by the produce; must also be in `RESOURCE_HISTORY_KAFKA_RESOURCES` |
| `RESOURCE_HISTORY_KAFKA_TOPIC` | `fhir_server.resource-history.events` | Target topic |
| `RESOURCE_HISTORY_KAFKA_BATCH_SIZE` | 50 | Messages per produce call; non-positive/non-numeric falls back to 50 |
| `KAFKA_PRODUCER_TIMEOUT_MS` | 10000 | Per-attempt produce timeout in ms (history and the AuditEvent ClickPipe path); non-positive/non-numeric falls back to 10000 |
| `KAFKA_PRODUCER_COMPRESSION` | `zstd` | Compression for history and the AuditEvent ClickPipe path (`none`/`gzip`/`zstd`) |

## Kafka-only history (MongoDB write disabled)

For a type in `RESOURCE_HISTORY_MONGO_DISABLED_RESOURCES` (and in `RESOURCE_HISTORY_KAFKA_RESOURCES`),
the history flush produces first and writes to MongoDB only the documents Kafka did not accept
(after the retries and timeout below), so a Kafka outage loses no history and never fails the FHIR
write. Each fallback is logged (resource type, count, reason; no ids or payloads) and counted in
`fhir_history_mongo_fallback_total{resource_type,reason}`. Other types, and a type in only the produce
list, keep the parallel write above. Enable a type only after its `_history` reads are served from
ClickHouse: no ClickHouse `_history`/vread read path exists in this repo yet (the read path still queries
only MongoDB), so listing a type before one ships hides its new versions from those reads. Retention
also changes: MongoDB history has no expiry, while `fhir.Resource_4_0_0_History` deletes rows after
13 months (`TTL`, `clickhouse-init/08-resource-history.sql`); align the table's TTL with the required
history retention before listing a type. After a broker-level failure (retries used up or timeout) the
remaining chunks of that flush are not sent and fall back to MongoDB straight away. Replaying fallback documents to Kafka and deleting migrated MongoDB history are separate work.

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
  `useHistoryCollection === true`, only for types in the allowlist. The produce is awaited right after
  the history write, in whichever context that write runs (post-request task, or inline for delete via
  `executeHistoryAsync`), so a delete response waits for it.
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
  `ce_id`, batch-size validation) and the hook on both inserters (order, skip on error, skip when not enabled).
- Integration (`src/tests/integration/dataLayer/databaseBulkInserter/historyKafkaProduce.test.js`):
  flag off, one type, two types, Kafka down, and the `postSaveAsync` writer; synthetic data only.
- Not done: dev-environment verification (consume the topic; confirm events, headers, compression,
  size under 17 MB; disable and confirm no new events).
