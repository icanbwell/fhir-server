-- Migration: AccessLog schema optimization
-- Fixes: OOM during background merges caused by details JSON(max_dynamic_paths=64)
--         and daily partitioning on a high-volume table.
-- Changes: details max_dynamic_paths 64 → 16, PARTITION BY toDate → toYYYYMM
--
-- Run this against ClickHouse Cloud manually. The RENAME is atomic.
-- After verifying row counts match, DROP the _old table.

-- Step 1: Create new table with optimized schema
CREATE TABLE IF NOT EXISTS fhir.AccessLog_v2 (
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

-- Step 2: Backfill existing data
INSERT INTO fhir.AccessLog_v2 SELECT * FROM fhir.AccessLog;

-- Step 3: Atomic swap (run only after step 2 completes successfully)
-- RENAME TABLE fhir.AccessLog TO fhir.AccessLog_old, fhir.AccessLog_v2 TO fhir.AccessLog;

-- Step 4: Verify counts match
-- SELECT count() FROM fhir.AccessLog;
-- SELECT count() FROM fhir.AccessLog_old;

-- Step 5: Drop old table once verified
-- DROP TABLE fhir.AccessLog_old;
