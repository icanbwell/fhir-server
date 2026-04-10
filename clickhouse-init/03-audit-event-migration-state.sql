-- Migration State Table for AuditEvent Archive → ClickHouse Migration
-- Tracks per-day partition progress for resume-safe bulk migration
-- Used by: src/scripts/migrate_audit_events_to_clickhouse.js

CREATE TABLE IF NOT EXISTS fhir.audit_event_migration_state (
    partition_day     String,                          -- e.g., '2022-01-01'
    status            LowCardinality(String),          -- 'pending', 'in_progress', 'completed', 'failed'
    source_count      UInt64 DEFAULT 0,                -- doc count from Atlas Data Federation
    inserted_count    UInt64 DEFAULT 0,                -- rows inserted into ClickHouse
    last_mongo_id     String DEFAULT '',               -- resume cursor position (_id)
    started_at        Nullable(DateTime64(3, 'UTC')),
    completed_at      Nullable(DateTime64(3, 'UTC')),
    error_message     String DEFAULT '',
    updated_at        DateTime64(3, 'UTC')
) ENGINE = MergeTree()
ORDER BY (partition_day);
