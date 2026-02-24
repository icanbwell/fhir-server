-- ClickHouse Database Initialization for FHIR Server
-- Event-sourced schema for Group member tracking with derived current-state tables
-- Plan version: Final (event log + materialized-view-maintained current state, no time partitions)

CREATE DATABASE IF NOT EXISTS fhir;

-- Note: SET commands are session-scoped. This script must be executed
-- with clickhouse-client --multiquery to apply these limits to subsequent statements.
SET max_ast_depth = 10000;
SET max_expanded_ast_elements = 500000;

-- ===========================================================================
-- Table: fhir.fhir_group_member_events (Event Log - Append Only)
-- ===========================================================================
-- Stores all Group membership changes as immutable events (source of truth).
-- Reads that require "current state" should use the derived current tables.

CREATE TABLE IF NOT EXISTS fhir.fhir_group_member_events
(
    -- Group identity
    group_id String,

    -- member.entity (R! 1..1 per R4B spec)
    entity_reference String,
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
-- Derived Table: fhir.fhir_group_member_current (Current State by Group + Member)
-- ===========================================================================
-- One logical row per (group_id, entity_reference) after background merges.
-- This is the hot path for:
--   - List members of group (paged/streamed)
--   - Member state checks
--   - Updating Group.quantity in Mongo

CREATE TABLE IF NOT EXISTS fhir.fhir_group_member_current
(
    group_id String,
    entity_reference String,

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
CREATE MATERIALIZED VIEW IF NOT EXISTS fhir.mv_group_member_current
TO fhir.fhir_group_member_current
AS
SELECT
    group_id,
    entity_reference,
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
    FROM fhir.fhir_group_member_events
)
GROUP BY group_id, entity_reference;

-- ===========================================================================
-- Derived Table: fhir.fhir_group_member_current_by_entity (Reverse Lookup)
-- ===========================================================================
-- Lightweight current-state index optimized for:
--   - "Which groups is Patient/X currently in?"
--   - FHIR search-style semantics like GET /Group?member=Patient/X
-- Includes security tags (access_tags, owner_tags) for authorization filtering.
-- Excludes other provenance/metadata to keep it relatively fast.

CREATE TABLE IF NOT EXISTS fhir.fhir_group_member_current_by_entity
(
    entity_reference String,
    group_id String,

    event_type AggregateFunction(argMax, Enum8('added' = 1, 'removed' = 2), Tuple(DateTime64(3, 'UTC'), UUID)),
    inactive   AggregateFunction(argMax, UInt8, Tuple(DateTime64(3, 'UTC'), UUID)),

    -- Security/authorization tags (added for Gate 3)
    -- These enable security filtering at the database level for member lookups
    access_tags AggregateFunction(argMax, Array(String), Tuple(DateTime64(3, 'UTC'), UUID)),
    owner_tags  AggregateFunction(argMax, Array(String), Tuple(DateTime64(3, 'UTC'), UUID))
)
ENGINE = AggregatingMergeTree
ORDER BY (entity_reference, group_id);

CREATE MATERIALIZED VIEW IF NOT EXISTS fhir.mv_group_member_current_by_entity
TO fhir.fhir_group_member_current_by_entity
AS
SELECT
    entity_reference,
    group_id,
    argMaxState(event_type, tie) AS event_type,
    argMaxState(inactive, tie) AS inactive,
    argMaxState(access_tags, tie) AS access_tags,
    argMaxState(owner_tags, tie) AS owner_tags
FROM (
    SELECT
        entity_reference,
        group_id,
        event_type,
        event_time,
        event_id,
        inactive,
        access_tags,
        owner_tags,
        tuple(event_time, event_id) AS tie
    FROM fhir.fhir_group_member_events
)
GROUP BY entity_reference, group_id;

-- ===========================================================================
-- Backfill (OPTIONAL - only needed when migrating existing event data)
-- ===========================================================================
-- ClickHouse materialized views process NEW inserts only.
-- If fhir_group_member_events already has data when you deploy this schema,
-- you must backfill the derived tables once.
--
-- ⚠️  WARNING: DO NOT RUN IN PRODUCTION ⚠️
-- This will TRUNCATE current state tables and rebuild from event log.
-- Only run this intentionally during migration, not as part of normal init.
--
-- For fresh deployments, this backfill is NOT needed.
-- Test data should be cleaned up by test teardown, not this init script.
--
-- Uncomment the following block to run one-time backfill during migration:

-- TRUNCATE TABLE fhir.fhir_group_member_current;
-- TRUNCATE TABLE fhir.fhir_group_member_current_by_entity;
--
-- -- Backfill current-by-group table:
-- INSERT INTO fhir.fhir_group_member_current
-- SELECT
--     group_id,
--     entity_reference,
--     argMaxState(entity_type, tie) AS entity_type,
--     argMaxState(event_type, tie) AS event_type,
--     argMaxState(event_time, tie) AS event_time,
--     argMaxState(event_id, tie) AS event_id,
--     argMaxState(period_start, tie) AS period_start,
--     argMaxState(period_end, tie) AS period_end,
--     argMaxState(inactive, tie) AS inactive,
--     argMaxState(actor, tie) AS actor,
--     argMaxState(reason, tie) AS reason,
--     argMaxState(source, tie) AS source,
--     argMaxState(correlation_id, tie) AS correlation_id,
--     argMaxState(group_source_id, tie) AS group_source_id,
--     argMaxState(group_source_assigning_authority, tie) AS group_source_assigning_authority,
--     argMaxState(access_tags, tie) AS access_tags,
--     argMaxState(owner_tags, tie) AS owner_tags
-- FROM (
--     SELECT
--         group_id,
--         entity_reference,
--         entity_type,
--         event_type,
--         event_time,
--         event_id,
--         period_start,
--         period_end,
--         inactive,
--         actor,
--         reason,
--         source,
--         correlation_id,
--         group_source_id,
--         group_source_assigning_authority,
--         access_tags,
--         owner_tags,
--         tuple(event_time, event_id) AS tie
--     FROM fhir.fhir_group_member_events
-- )
-- GROUP BY group_id, entity_reference;
--
-- -- Backfill reverse lookup table:
-- INSERT INTO fhir.fhir_group_member_current_by_entity
-- SELECT
--     entity_reference,
--     group_id,
--     argMaxState(event_type, tie) AS event_type,
--     argMaxState(inactive, tie) AS inactive,
--     argMaxState(access_tags, tie) AS access_tags,
--     argMaxState(owner_tags, tie) AS owner_tags
-- FROM (
--     SELECT
--         entity_reference,
--         group_id,
--         event_type,
--         event_time,
--         event_id,
--         inactive,
--         access_tags,
--         owner_tags,
--         tuple(event_time, event_id) AS tie
--     FROM fhir.fhir_group_member_events
-- )
-- GROUP BY entity_reference, group_id;

-- Operational note:
-- For strict correctness during backfill, pause membership writes (or buffer) if possible.
-- If your pipeline can emit out-of-order events (late event_time), avoid time-window backfills.

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
--     FROM fhir.fhir_group_member_current
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
--     FROM fhir.fhir_group_member_current
--     WHERE group_id = 'group-123'
--     GROUP BY entity_reference
--     HAVING argMaxMerge(event_type) = 'added'
--        AND argMaxMerge(inactive) = 0
-- );

-- Reverse lookup: groups for a member
-- SELECT group_id
-- FROM fhir.fhir_group_member_current_by_entity
-- WHERE entity_reference = 'Patient/123'
-- GROUP BY group_id
-- HAVING argMaxMerge(event_type) = 'added'
--    AND argMaxMerge(inactive) = 0;

-- Full event history for a member in a group (care gap timeline)
-- SELECT
--     event_type, event_time, event_id,
--     period_start, period_end, inactive,
--     actor, reason, source, correlation_id
-- FROM fhir.fhir_group_member_events
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

-- ===========================================================================
-- FHIR Subscription Event Log for SSE Replay Support
-- ===========================================================================
-- Stores subscription notification events for replay when clients reconnect
-- with Last-Event-Id header. Events are retained based on configurable TTL.

CREATE TABLE IF NOT EXISTS fhir.fhir_subscription_events
(
    -- Event identity
    event_id String,                                    -- UUID, used as SSE id: field
    sequence_number UInt64,                              -- Monotonically increasing for ordering
    
    -- Subscription reference
    subscription_id String,                              -- FHIR Subscription resource ID
    topic_url String DEFAULT '',                         -- SubscriptionTopic canonical URL
    
    -- Event metadata
    event_type Enum8('notification' = 1, 'handshake' = 2, 'heartbeat' = 3, 'error' = 4),
    event_time DateTime64(3, 'UTC') DEFAULT now64(3, 'UTC'),
    
    -- Trigger information
    trigger_resource_type LowCardinality(String),        -- e.g., 'Patient', 'Observation'
    trigger_resource_id String,                          -- ID of the resource that triggered the event
    trigger_action Enum8('create' = 1, 'update' = 2, 'delete' = 3),
    
    -- Notification payload (FHIR Bundle as JSON)
    payload String,                                      -- JSON-encoded SubscriptionStatus Bundle
    
    -- Provenance/tracking
    request_id String DEFAULT '',                        -- Original request that caused the change
    client_id String DEFAULT '',                         -- Client that owns the subscription
    
    -- TTL for automatic cleanup
    expire_time DateTime64(3, 'UTC') DEFAULT now64(3, 'UTC') + INTERVAL 7 DAY
)
ENGINE = MergeTree()
PARTITION BY toYYYYMMDD(event_time)
ORDER BY (subscription_id, sequence_number, event_id)
TTL expire_time DELETE;

-- Index for efficient replay queries (get events after a specific sequence number)
ALTER TABLE fhir.fhir_subscription_events
ADD INDEX IF NOT EXISTS idx_subscription_sequence (subscription_id, sequence_number) TYPE minmax GRANULARITY 1;

-- Index for cleanup queries
ALTER TABLE fhir.fhir_subscription_events
ADD INDEX IF NOT EXISTS idx_expire_time (expire_time) TYPE minmax GRANULARITY 1;

-- ===========================================================================
-- Subscription Event Sequence Generator
-- ===========================================================================
-- Tracks the latest sequence number per subscription for generating new event IDs

CREATE TABLE IF NOT EXISTS fhir.fhir_subscription_sequence
(
    subscription_id String,
    last_sequence_number UInt64,
    last_updated DateTime64(3, 'UTC') DEFAULT now64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(last_updated)
ORDER BY subscription_id;

-- ===========================================================================
-- Subscription Event Statistics (for monitoring)
-- ===========================================================================
-- Aggregated view of subscription event counts

CREATE TABLE IF NOT EXISTS fhir.fhir_subscription_event_stats
(
    subscription_id String,
    event_date Date,
    notification_count AggregateFunction(count, UInt64),
    handshake_count AggregateFunction(count, UInt64),
    heartbeat_count AggregateFunction(count, UInt64),
    error_count AggregateFunction(count, UInt64)
)
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(event_date)
ORDER BY (subscription_id, event_date);

-- MV: Maintain subscription event statistics
CREATE MATERIALIZED VIEW IF NOT EXISTS fhir.mv_subscription_event_stats
TO fhir.fhir_subscription_event_stats
AS
SELECT
    subscription_id,
    toDate(event_time) AS event_date,
    countStateIf(1, event_type = 'notification') AS notification_count,
    countStateIf(1, event_type = 'handshake') AS handshake_count,
    countStateIf(1, event_type = 'heartbeat') AS heartbeat_count,
    countStateIf(1, event_type = 'error') AS error_count
FROM fhir.fhir_subscription_events
GROUP BY subscription_id, event_date;

-- ===========================================================================
-- Example Queries for Subscription Events
-- ===========================================================================

-- Replay events for a subscription after a specific sequence number (for SSE reconnect)
-- SELECT event_id, sequence_number, event_type, payload
-- FROM fhir.fhir_subscription_events
-- WHERE subscription_id = 'sub-123'
--   AND sequence_number > 1000  -- Last-Event-Id parsed as sequence number
-- ORDER BY sequence_number ASC
-- LIMIT 1000;

-- Get latest sequence number for a subscription
-- SELECT max(sequence_number) as latest_sequence
-- FROM fhir.fhir_subscription_events
-- WHERE subscription_id = 'sub-123';

-- Get event count per subscription (last 24 hours)
-- SELECT
--     subscription_id,
--     countMerge(notification_count) as notifications,
--     countMerge(handshake_count) as handshakes,
--     countMerge(heartbeat_count) as heartbeats,
--     countMerge(error_count) as errors
-- FROM fhir.fhir_subscription_event_stats
-- WHERE event_date >= today() - 1
-- GROUP BY subscription_id;

SELECT 'ClickHouse FHIR Subscription Events schema initialized' AS status;
