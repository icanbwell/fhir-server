-- Migration State Table for AuditEvent Archive → ClickHouse Migration
-- Tracks per-day partition progress for resume-safe bulk migration.
-- Uses ReplacingMergeTree so state updates are INSERTs (not ALTER TABLE UPDATE mutations).
-- Query with FINAL to get latest state per partition_day.
-- Used by: src/scripts/migrate_audit_events_to_clickhouse.js

CREATE TABLE IF NOT EXISTS fhir.audit_event_migration_state (
    partition_day     String,
    status            LowCardinality(String),
    source_count      UInt64 DEFAULT 0,
    inserted_count    UInt64 DEFAULT 0,
    last_mongo_id     String DEFAULT '',
    last_recorded     String DEFAULT '',
    started_at        Nullable(DateTime64(3, 'UTC')),
    completed_at      Nullable(DateTime64(3, 'UTC')),
    error_message     String DEFAULT '',
    updated_at        DateTime64(3, 'UTC')
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (partition_day);

-- For already-initialized deployments, add the column in place.
-- Safe to run repeatedly; no-op on fresh installs that hit the CREATE above.
ALTER TABLE fhir.audit_event_migration_state
    ADD COLUMN IF NOT EXISTS last_recorded String DEFAULT '' AFTER last_mongo_id;
