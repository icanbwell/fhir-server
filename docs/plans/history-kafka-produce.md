# Plan: parallel history produce to Kafka

Spec: `docs/specs/history-kafka-produce.md`.

## Steps

1. Config: add `kafkaHistoryResources`, `kafkaHistoryEventsTopic`, `historyKafkaBatchSize`
   (validated, default 50) to `src/utils/configManager.js`.
2. Metrics: add the produced / failed / duration instruments and `recordHistoryKafkaProduce` to
   `src/utils/metrics.js`.
3. `retryWithBackoff`: opt-in `jitter` (default behaviour unchanged).
4. `HistoryKafkaProducer` (`src/dataLayer/historyKafkaProducer.js`): allowlist check, chunking,
   timeout, retries, record-by-record isolation, message shape; never throws.
5. Wire it: register `historyKafkaProducer` in `src/createContainer.js`; inject into
   `DatabaseBulkInserter`, `FastDatabaseBulkInserter` and (via `DatabaseUpdateFactory`)
   `DatabaseUpdateManager`.
6. Hook: call it after the history write in both inserters (queued post-request for the inline
   delete flush; skipped when the write errored) and after `insertOne` in
   `DatabaseUpdateManager.postSaveAsync`.
7. Tests: unit and integration as listed in the spec.
8. Verify: unit suites, related integration suites, lint; check the diff against `review.md`.
9. Rollout (not yet done): in dev set `KAFKA_HISTORY_RESOURCES` to one synthetic type, write /
   update / delete, consume the topic and confirm events, headers, compression and size; then empty
   the list and confirm no new events. Widen one type at a time while watching the metrics.

## Risks and follow-ups

- Confirm `ce_type`, the partition key (tenant prefix) with EA; update the
  TDD for the flag names.
- A produce timeout or Kafka outage holds the post-request task open (not the client response).
- Phase 3 (Kafka-primary, MongoDB fallback replay) is out of scope.
