-- Migration State Table for AuditEvent Archive → ClickHouse Migration
-- Tracks per-hour partition progress for resume-safe bulk migration.
-- Uses ReplacingMergeTree so state updates are INSERTs (not ALTER TABLE UPDATE mutations).
-- Query with FINAL to get latest state per partition_hour.
-- Used by: src/admin/scripts/migrateAuditEventsToClickhouse.js

-- Drop the legacy day-grained table; callers have agreed no rows need to survive.
DROP TABLE IF EXISTS fhir.audit_event_migration_state;

CREATE TABLE IF NOT EXISTS fhir.audit_event_migration_state (
    partition_hour    String,               -- 'YYYY-MM-DDTHH' (UTC), e.g. '2024-05-10T15'
    status            LowCardinality(String),
    source_count      UInt64 DEFAULT 0,
    inserted_count    UInt64 DEFAULT 0,
    started_at        Nullable(DateTime64(3, 'UTC')),
    completed_at      Nullable(DateTime64(3, 'UTC')),
    error_message     String DEFAULT '',
    updated_at        DateTime64(3, 'UTC')
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (partition_hour);
