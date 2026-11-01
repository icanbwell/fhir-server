# Plan: parallel history produce to Kafka

Spec: `docs/specs/history-kafka-produce.md`.

## Steps

1. Config in `src/utils/configManager.js`: `kafkaHistoryResources`, `kafkaHistoryEventsTopic`,
   `historyKafkaBatchSize` (validated, default 50), and a generic `kafkaProducerCompression`
   (`KAFKA_PRODUCER_COMPRESSION`, default zstd) that replaces `auditEventClickPipeCompression` for both
   the AuditEvent ClickPipe path and history. No deployment config sets the old variable, so there is
   no fallback.
2. Metrics: produced / failed / duration instruments and `recordHistoryKafkaProduce` in
   `src/utils/metrics.js`.
3. `retryWithBackoff`: opt-in `jitter` (default behaviour unchanged).
4. `HistoryKafkaProducer` (`src/dataLayer/historyKafkaProducer.js`): allowlist check, chunking,
   per-attempt timeout, retries, record-by-record isolation of a rejected chunk, message shape. Never
   throws; failures are logged and counted. No dead-letter topic (producer only).
5. Wire it: register `historyKafkaProducer` in `src/createContainer.js`; inject into
   `DatabaseBulkInserter`, `FastDatabaseBulkInserter` and (via `DatabaseUpdateFactory`)
   `DatabaseUpdateManager`.
6. Hook: call it after the history write in both inserters (awaited, including the inline
   delete flush; skipped when the write errored or the type is not enabled) and after `insertOne` in
   `DatabaseUpdateManager.postSaveAsync`.
7. Contract: `src/dataLayer/historyKafkaProducer.asyncapi.yaml`, aligned with the event
   standard (`content-type`, `ce_source` as a URI, required `traceparent`).
8. Tests: unit (producer, hook, config) and integration
   (`historyKafkaProduce.test.js`: flag off, one type, two types, Kafka down, admin writer).
9. Verify: unit suites, related integration suites, lint; diff checked against `review.md`.
10. Rollout: in dev set `KAFKA_HISTORY_RESOURCES` to one synthetic type, write / update /
    delete, consume the topic and confirm events, headers, compression and size; then empty the list
    and confirm no new events. Widen one type at a time while watching the metrics.
