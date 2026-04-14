-- ClickHouse Database Initialization for FHIR Server
-- Event-sourced schema for Group member tracking with derived current-state tables
-- Plan version: Final (event log + materialized-view-maintained current state, no time partitions)

CREATE DATABASE IF NOT EXISTS fhir;

-- Note: SET commands are session-scoped. This script must be executed
-- with clickhouse-client --multiquery to apply these limits to subsequent statements.
SET max_ast_depth = 10000;
SET max_expanded_ast_elements = 500000;

-- ===========================================================================
-- Table: fhir.Group_4_0_0_MemberEvents (Event Log - Append Only)
-- ===========================================================================
-- Stores all Group membership changes as immutable events (source of truth).
-- Reads that require "current state" should use the derived current tables.

CREATE TABLE IF NOT EXISTS fhir.Group_4_0_0_MemberEvents
(
    -- Group identity
    group_id String,

    -- member.entity (R! 1..1 per R4B spec)
    entity_reference String,
    entity_reference_uuid String DEFAULT '',
    entity_reference_source_id String DEFAULT '',
    entity_type LowCardinality(String),

    -- Event semantics (storage-layer, not FHIR)
    event_type Enum8('added' = 1, 'removed' = 2),
    event_time DateTime64(3, 'UTC') DEFAULT now64(3, 'UTC'),
    event_id UUID DEFAULT generateUUIDv4(),  -- Tie-breaker for argMax

    -- member.period (0..1)
    period_start Nullable(DateTime64(3, 'UTC')),
    period_end Nullable(DateTime64(3, 'UTC')),

    -- member.inactive (0..1) - NOT the same as removed
    inactive UInt8 DEFAULT 0,

    -- Provenance of change (latest values are carried into current-state table)
    actor String DEFAULT '',
    reason LowCardinality(String) DEFAULT '',
    source LowCardinality(String) DEFAULT '',
    correlation_id String DEFAULT '',

    -- Security/metadata
    group_source_id String DEFAULT '',
    group_source_assigning_authority String DEFAULT '',
    access_tags Array(String) DEFAULT [],
    owner_tags Array(String) DEFAULT [],

    -- Derived from owner_tags[0] at write time
    -- Matches MongoDB's _sourceAssigningAuthority field
    -- Represents the managing organization (primary owner)
    source_assigning_authority LowCardinality(String) DEFAULT ''
)
ENGINE = MergeTree()
ORDER BY (group_id, entity_reference, event_time, event_id);

-- No PARTITION BY:
-- Primary access patterns are group-centric and must consider full history for correctness.
-- Time partitioning fragments group history across partitions and harms "current roster" derivation.
-- If lifecycle management is needed later, consider partitioning by a stable group_id hash bucket.

-- ===========================================================================
-- Derived Table: fhir.Group_4_0_0_MemberCurrent (Current State by Group + Member)
-- ===========================================================================
-- One logical row per (group_id, entity_reference) after background merges.
-- This is the hot path for:
--   - List members of group (paged/streamed)
--   - Member state checks
--   - Updating Group.quantity in Mongo

CREATE TABLE IF NOT EXISTS fhir.Group_4_0_0_MemberCurrent
(
    group_id String,
    entity_reference String,
    entity_reference_uuid AggregateFunction(argMax, String, Tuple(DateTime64(3, 'UTC'), UUID)),
    entity_reference_source_id AggregateFunction(argMax, String, Tuple(DateTime64(3, 'UTC'), UUID)),

    -- Latest entity_type (kept consistent with other columns)
    entity_type AggregateFunction(argMax, LowCardinality(String), Tuple(DateTime64(3, 'UTC'), UUID)),

    -- Latest membership state
    event_type AggregateFunction(argMax, Enum8('added' = 1, 'removed' = 2), Tuple(DateTime64(3, 'UTC'), UUID)),
    event_time AggregateFunction(argMax, DateTime64(3, 'UTC'), Tuple(DateTime64(3, 'UTC'), UUID)),
    event_id   AggregateFunction(argMax, UUID, Tuple(DateTime64(3, 'UTC'), UUID)),

    period_start AggregateFunction(argMax, Nullable(DateTime64(3, 'UTC')), Tuple(DateTime64(3, 'UTC'), UUID)),
    period_end   AggregateFunction(argMax, Nullable(DateTime64(3, 'UTC')), Tuple(DateTime64(3, 'UTC'), UUID)),
    inactive     AggregateFunction(argMax, UInt8, Tuple(DateTime64(3, 'UTC'), UUID)),

    -- Latest provenance for this member state
    actor          AggregateFunction(argMax, String, Tuple(DateTime64(3, 'UTC'), UUID)),
    reason         AggregateFunction(argMax, LowCardinality(String), Tuple(DateTime64(3, 'UTC'), UUID)),
    source         AggregateFunction(argMax, LowCardinality(String), Tuple(DateTime64(3, 'UTC'), UUID)),
    correlation_id AggregateFunction(argMax, String, Tuple(DateTime64(3, 'UTC'), UUID)),

    -- Latest security/metadata (copied from the event that produced the latest state)
    group_source_id AggregateFunction(argMax, String, Tuple(DateTime64(3, 'UTC'), UUID)),
    group_source_assigning_authority AggregateFunction(argMax, String, Tuple(DateTime64(3, 'UTC'), UUID)),
    access_tags AggregateFunction(argMax, Array(String), Tuple(DateTime64(3, 'UTC'), UUID)),
    owner_tags  AggregateFunction(argMax, Array(String), Tuple(DateTime64(3, 'UTC'), UUID))
)
ENGINE = AggregatingMergeTree
ORDER BY (group_id, entity_reference);

-- MV: Maintain current member state as events arrive
CREATE MATERIALIZED VIEW IF NOT EXISTS fhir.Group_4_0_0_MemberCurrent_MV
TO fhir.Group_4_0_0_MemberCurrent
AS
SELECT
    group_id,
    entity_reference,
    argMaxState(entity_reference_uuid, tie) AS entity_reference_uuid,
    argMaxState(entity_reference_source_id, tie) AS entity_reference_source_id,
    argMaxState(entity_type, tie) AS entity_type,
    argMaxState(event_type, tie) AS event_type,
    argMaxState(event_time, tie) AS event_time,
    argMaxState(event_id, tie) AS event_id,
    argMaxState(period_start, tie) AS period_start,
    argMaxState(period_end, tie) AS period_end,
    argMaxState(inactive, tie) AS inactive,
    argMaxState(actor, tie) AS actor,
    argMaxState(reason, tie) AS reason,
    argMaxState(source, tie) AS source,
    argMaxState(correlation_id, tie) AS correlation_id,
    argMaxState(group_source_id, tie) AS group_source_id,
    argMaxState(group_source_assigning_authority, tie) AS group_source_assigning_authority,
    argMaxState(access_tags, tie) AS access_tags,
    argMaxState(owner_tags, tie) AS owner_tags
FROM (
    SELECT
        group_id,
        entity_reference,
        entity_reference_uuid,
        entity_reference_source_id,
        entity_type,
        event_type,
        event_time,
        event_id,
        period_start,
        period_end,
        inactive,
        actor,
        reason,
        source,
        correlation_id,
        group_source_id,
        group_source_assigning_authority,
        access_tags,
        owner_tags,
        tuple(event_time, event_id) AS tie
    FROM fhir.Group_4_0_0_MemberEvents
)
GROUP BY group_id, entity_reference;

-- ===========================================================================
-- Derived Table: fhir.Group_4_0_0_MemberCurrentByEntity (Reverse Lookup)
-- ===========================================================================
-- Lightweight current-state index optimized for:
--   - "Which groups is Patient/X currently in?"
--   - FHIR search-style semantics like GET /Group?member=Patient/X
-- Includes security tags (access_tags, owner_tags) for authorization filtering.
-- Excludes other provenance/metadata to keep it relatively fast.

CREATE TABLE IF NOT EXISTS fhir.Group_4_0_0_MemberCurrentByEntity
(
    entity_reference String,
    group_id String,
    entity_reference_uuid AggregateFunction(argMax, String, Tuple(DateTime64(3, 'UTC'), UUID)),
    entity_reference_source_id AggregateFunction(argMax, String, Tuple(DateTime64(3, 'UTC'), UUID)),

    event_type AggregateFunction(argMax, Enum8('added' = 1, 'removed' = 2), Tuple(DateTime64(3, 'UTC'), UUID)),
    inactive   AggregateFunction(argMax, UInt8, Tuple(DateTime64(3, 'UTC'), UUID)),

    -- Security/authorization tags (added for Gate 3)
    -- These enable security filtering at the database level for member lookups
    access_tags AggregateFunction(argMax, Array(String), Tuple(DateTime64(3, 'UTC'), UUID)),
    owner_tags  AggregateFunction(argMax, Array(String), Tuple(DateTime64(3, 'UTC'), UUID))
)
ENGINE = AggregatingMergeTree
ORDER BY (entity_reference, group_id);

CREATE MATERIALIZED VIEW IF NOT EXISTS fhir.Group_4_0_0_MemberCurrentByEntity_MV
TO fhir.Group_4_0_0_MemberCurrentByEntity
AS
SELECT
    entity_reference,
    group_id,
    argMaxState(entity_reference_uuid, tie) AS entity_reference_uuid,
    argMaxState(entity_reference_source_id, tie) AS entity_reference_source_id,
    argMaxState(event_type, tie) AS event_type,
    argMaxState(inactive, tie) AS inactive,
    argMaxState(access_tags, tie) AS access_tags,
    argMaxState(owner_tags, tie) AS owner_tags
FROM (
    SELECT
        entity_reference,
        group_id,
        entity_reference_uuid,
        entity_reference_source_id,
        event_type,
        event_time,
        event_id,
        inactive,
        access_tags,
        owner_tags,
        tuple(event_time, event_id) AS tie
    FROM fhir.Group_4_0_0_MemberEvents
)
GROUP BY entity_reference, group_id;

-- ===========================================================================
-- Helper Queries (reference/documentation)
-- ===========================================================================

-- Current members of a group (seek pagination recommended)
-- WITH filtered AS
-- (
--     SELECT
--         entity_reference,
--         argMaxMerge(entity_type) AS entity_type,
--         argMaxMerge(inactive) AS inactive
--     FROM fhir.Group_4_0_0_MemberCurrent
--     WHERE group_id = 'group-123'
--       AND entity_reference > 'Patient/000123'   -- cursor
--     GROUP BY entity_reference
--     HAVING argMaxMerge(event_type) = 'added'
--        AND argMaxMerge(inactive) = 0
-- )
-- SELECT entity_reference, entity_type, inactive
-- FROM filtered
-- ORDER BY entity_reference
-- LIMIT 100;

-- Update Group.quantity in Mongo (count current active members)
-- SELECT count()
-- FROM
-- (
--     SELECT entity_reference
--     FROM fhir.Group_4_0_0_MemberCurrent
--     WHERE group_id = 'group-123'
--     GROUP BY entity_reference
--     HAVING argMaxMerge(event_type) = 'added'
--        AND argMaxMerge(inactive) = 0
-- );

-- Reverse lookup: groups for a member
-- SELECT group_id
-- FROM fhir.Group_4_0_0_MemberCurrentByEntity
-- WHERE entity_reference = 'Patient/123'
-- GROUP BY group_id
-- HAVING argMaxMerge(event_type) = 'added'
--    AND argMaxMerge(inactive) = 0;

-- Full event history for a member in a group (care gap timeline)
-- SELECT
--     event_type, event_time, event_id,
--     period_start, period_end, inactive,
--     actor, reason, source, correlation_id
-- FROM fhir.Group_4_0_0_MemberEvents
-- WHERE group_id = 'group-123'
--   AND entity_reference = 'Patient/456'
-- ORDER BY event_time, event_id;

-- ===========================================================================
-- Group.quantity semantics
-- ===========================================================================
-- Group.quantity counts "active participants" only:
--   - event_type = 'added' AND inactive = 0
--   - NOT "all members" (which would include inactive=1 members)
--   - This matches the roster endpoint default behavior (active-by-default)
--
-- Members with inactive=1 are still in the group but not currently participating.
-- The inactive flag exists for FHIR compliance but may not be used in real workflows.

-- ===========================================================================
-- Operational notes: merges, concurrency, and telemetry coexistence
-- ===========================================================================
-- Most of these are configured at the server/profile level rather than via SQL migrations.
--
-- 1) Resource isolation (recommended if telemetry shares the cluster)
--    - Put telemetry tables and membership tables on separate disks/volumes using a storage policy
--      (storage_configuration / storage_policies in ClickHouse config).
--    - If you can, split telemetry and membership onto separate ClickHouse clusters.
--
-- 2) Protect membership queries from merge pressure
--    Background merges are the common source of "surprise latency" when telemetry is high volume.
--    Review server-level knobs:
--      - background_pool_size
--      - background_merges_mutations_concurrency
--      - background_schedule_pool_size
--      - max_bytes_to_merge_at_max_space_in_pool
--      - parts_to_delay_insert / parts_to_throw_insert (telemetry tables especially)
--      - max_parts_in_total
--
-- 3) Concurrency controls (membership API user/profile)
--    For the membership query user, consider a profile that caps runaway parallelism:
--      - max_concurrent_queries (per user)
--      - max_threads (per query)
--      - max_memory_usage / max_memory_usage_for_user
--      - max_execution_time (guardrail)
--
--    Example (session-level for testing; production is usually SETTINGS PROFILE / user config):
--      SET max_threads = 8;
--      SET max_concurrent_queries_for_user = 50;
--      SET max_execution_time = 30;

SELECT 'ClickHouse FHIR schema initialized successfully (event log + current state MVs)' AS status;
