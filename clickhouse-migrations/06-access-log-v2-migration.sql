-- Migration: AccessLog schema optimization (drop + recreate)
-- Fixes: OOM during background merges caused by details JSON(max_dynamic_paths=64)
--         and daily partitioning on a high-volume table.
-- Changes: details max_dynamic_paths 64 → 16, PARTITION BY toDate → toYYYYMM
--
-- ClickHouse does not allow renaming this table, so the schema change is applied as
-- DROP + CREATE instead of create-new / RENAME / backfill.
--
-- DESTRUCTIVE: all existing rows in fhir.AccessLog are lost. This is acceptable because
-- the table is debug-only (the write path is disabled for fhir-server-pipeline and
-- fhir-server-merge in prod, so no production audit data depends on it).
-- Confirm that is still true for the target environment before running.
--
-- Repeatable: safe to re-run. Apply to dev first, validate writes/reads, then promote.
-- Run each step against ClickHouse Cloud manually in order.
-- The DDL in step 2 must match clickhouse-init/04-access-log.sql.

-- Step 1: Drop the existing table (irreversible)
DROP TABLE IF EXISTS fhir.AccessLog;

-- Step 2: Create the table with the optimized schema
CREATE TABLE IF NOT EXISTS fhir.AccessLog (
    timestamp                    DateTime64(3, 'UTC'),
    outcome_desc                 LowCardinality(String),

    agent                        JSON(max_dynamic_paths=16),
    details                      JSON(max_dynamic_paths=16),
    request                      JSON(max_dynamic_paths=16),

    agent_altId                  String                 MATERIALIZED toString(agent.altId),
    origin_service               LowCardinality(String) MATERIALIZED toString(details.originService),
    request_id                   String                 MATERIALIZED toString(request.id),

    INDEX idx_request_id     request_id     TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_agent_altId    agent_altId    TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_origin_service origin_service TYPE bloom_filter(0.01) GRANULARITY 4
)
ENGINE = MergeTree()
ORDER BY timestamp
PARTITION BY toYYYYMM(timestamp)
TTL timestamp + INTERVAL 7 DAY DELETE;

-- Step 3: Verify the table exists and accepts reads
-- SHOW CREATE TABLE fhir.AccessLog;
-- SELECT count() FROM fhir.AccessLog;
