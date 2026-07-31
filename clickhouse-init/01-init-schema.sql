-- ClickHouse Database Initialization for FHIR Server
-- Event-sourced schema for Group member tracking with derived current-state tables
-- Plan version: Final (event log + materialized-view-maintained current state, no time partitions)

CREATE DATABASE IF NOT EXISTS fhir;

-- ===========================================================================
-- Table: fhir.Group_4_0_0_MemberEvents (Event Log - Append Only)
-- ===========================================================================
-- Stores all Group membership changes as immutable events (source of truth).
-- Reads that require "current state" should use the derived current tables.

CREATE TABLE IF NOT EXISTS fhir.Group_4_0_0_MemberEvents
(
    -- Group identity (see the note below the table). group_id is provenance, not identity.
    group_uuid String,
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

    -- Causal-ordering terms. version_id is the FHIR meta.versionId of the write that produced this
    -- event; it increments per resource version, so a later write wins. batch_seq orders events
    -- within a single write (same version_id). Together they lead the current-state tie-break
    -- tuple (version_id, batch_seq, event_time, event_id) in the views below, so a causally-later
    -- add/remove beats an earlier one even when event_time ties.
    version_id UInt64 DEFAULT 0,
    batch_seq UInt32 DEFAULT 0,

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
ORDER BY (group_uuid, entity_reference, event_time, event_id);

-- A Group is identified by group_uuid, which carries MongoDB's _uuid = uuidv5(id|assigningAuthority)
-- (see UuidColumnHandler). It is computed in Node before the write and copied here verbatim, so the
-- same value identifies the Group in MongoDB, in the AuditEvent tables, and here.
--
-- group_id holds the FHIR logical id and is payload: provenance and debugging only. A client can
-- choose it via update-as-create (PUT /Group/<id>), so it is unique only within a tenant, and
-- enrichment rewrites resource.id on the read path (IdEnrichmentProvider, and
-- GlobalIdEnrichmentProvider under Prefer: global_id=true), so it is not stable enough to identify
-- a row. group_source_assigning_authority is payload for the same reason: it is one half of the
-- input to group_uuid, kept for provenance rather than for narrowing.
--
-- Every query that narrows to "one Group" filters on group_uuid alone.

-- No PARTITION BY:
-- Primary access patterns are group-centric and must consider full history for correctness.
-- Time partitioning fragments group history across partitions and harms "current roster" derivation.
-- If lifecycle management is needed later, consider partitioning by a stable group_uuid hash bucket.

-- ===========================================================================
-- Derived Table: fhir.Group_4_0_0_MemberCurrent (Current State by Group + Member)
-- ===========================================================================
-- One logical row per (group_uuid, entity_reference) after background merges. On an
-- AggregatingMergeTree the sorting key IS the aggregation key, so this table's ORDER BY is the
-- identity of a member's current state, not merely an index: keyed on the logical id, two tenants'
-- Groups sharing that id and a member reference collapse into a single row and one tenant's
-- membership state silently overwrites the other's.
-- This is the hot path for:
--   - List members of group (paged/streamed)
--   - Member state checks
--   - Updating Group.quantity in Mongo

CREATE TABLE IF NOT EXISTS fhir.Group_4_0_0_MemberCurrent
(
    group_uuid String,

    -- Provenance, carried as latest-state metadata rather than identity: the logical id is
    -- client-settable and the authority is one half of the input to group_uuid.
    group_id AggregateFunction(argMax, String, Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),
    group_source_assigning_authority AggregateFunction(argMax, String, Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),

    entity_reference String,
    entity_reference_uuid AggregateFunction(argMax, String, Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),
    entity_reference_source_id AggregateFunction(argMax, String, Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),

    -- Latest entity_type (kept consistent with other columns)
    entity_type AggregateFunction(argMax, LowCardinality(String), Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),

    -- Latest membership state
    event_type AggregateFunction(argMax, Enum8('added' = 1, 'removed' = 2), Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),
    event_time AggregateFunction(argMax, DateTime64(3, 'UTC'), Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),
    event_id   AggregateFunction(argMax, UUID, Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),

    period_start AggregateFunction(argMax, Nullable(DateTime64(3, 'UTC')), Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),
    period_end   AggregateFunction(argMax, Nullable(DateTime64(3, 'UTC')), Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),
    inactive     AggregateFunction(argMax, UInt8, Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),

    -- Latest provenance for this member state
    actor          AggregateFunction(argMax, String, Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),
    reason         AggregateFunction(argMax, LowCardinality(String), Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),
    source         AggregateFunction(argMax, LowCardinality(String), Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),
    correlation_id AggregateFunction(argMax, String, Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),

    -- Latest security/metadata (copied from the event that produced the latest state)
    group_source_id AggregateFunction(argMax, String, Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),
    access_tags AggregateFunction(argMax, Array(String), Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),
    owner_tags  AggregateFunction(argMax, Array(String), Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID))
)
ENGINE = AggregatingMergeTree
ORDER BY (group_uuid, entity_reference);

-- MV: Maintain current member state as events arrive
CREATE MATERIALIZED VIEW IF NOT EXISTS fhir.Group_4_0_0_MemberCurrent_MV
TO fhir.Group_4_0_0_MemberCurrent
AS
SELECT
    group_uuid,
    argMaxState(group_id, tie) AS group_id,
    argMaxState(group_source_assigning_authority, tie) AS group_source_assigning_authority,
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
    argMaxState(access_tags, tie) AS access_tags,
    argMaxState(owner_tags, tie) AS owner_tags
FROM (
    SELECT
        group_uuid,
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
        version_id,
        batch_seq,
        tuple(version_id, batch_seq, event_time, event_id) AS tie
    FROM fhir.Group_4_0_0_MemberEvents
)
GROUP BY group_uuid, entity_reference;

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
    group_uuid String,

    -- Provenance for the Mongo hand-off and debugging, not identity. The reverse lookup returns
    -- group_uuid and matches Mongo on _uuid; a logical id would not be tenant-unique there either.
    group_id AggregateFunction(argMax, String, Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),
    group_source_assigning_authority AggregateFunction(argMax, String, Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),

    entity_reference_uuid AggregateFunction(argMax, String, Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),
    entity_reference_source_id AggregateFunction(argMax, String, Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),

    event_type AggregateFunction(argMax, Enum8('added' = 1, 'removed' = 2), Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),
    inactive   AggregateFunction(argMax, UInt8, Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),

    -- Security/authorization tags (added for Gate 3)
    -- These enable security filtering at the database level for member lookups
    access_tags AggregateFunction(argMax, Array(String), Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),
    owner_tags  AggregateFunction(argMax, Array(String), Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID))
)
ENGINE = AggregatingMergeTree
ORDER BY (entity_reference, group_uuid);

CREATE MATERIALIZED VIEW IF NOT EXISTS fhir.Group_4_0_0_MemberCurrentByEntity_MV
TO fhir.Group_4_0_0_MemberCurrentByEntity
AS
SELECT
    entity_reference,
    group_uuid,
    argMaxState(group_id, tie) AS group_id,
    argMaxState(group_source_assigning_authority, tie) AS group_source_assigning_authority,
    argMaxState(entity_reference_uuid, tie) AS entity_reference_uuid,
    argMaxState(entity_reference_source_id, tie) AS entity_reference_source_id,
    argMaxState(event_type, tie) AS event_type,
    argMaxState(inactive, tie) AS inactive,
    argMaxState(access_tags, tie) AS access_tags,
    argMaxState(owner_tags, tie) AS owner_tags
FROM (
    SELECT
        entity_reference,
        group_uuid,
        group_id,
        group_source_assigning_authority,
        entity_reference_uuid,
        entity_reference_source_id,
        event_type,
        event_time,
        event_id,
        inactive,
        access_tags,
        owner_tags,
        version_id,
        batch_seq,
        tuple(version_id, batch_seq, event_time, event_id) AS tie
    FROM fhir.Group_4_0_0_MemberEvents
)
GROUP BY entity_reference, group_uuid;

-- ===========================================================================
-- Helper Queries (reference/documentation)
-- ===========================================================================

-- NOTE: every "one Group" query below narrows on group_uuid. The logical id is payload — see the
-- identity note on the event log table.

-- Current members of a group (seek pagination recommended)
-- WITH filtered AS
-- (
--     SELECT
--         entity_reference,
--         argMaxMerge(entity_type) AS entity_type,
--         argMaxMerge(inactive) AS inactive
--     FROM fhir.Group_4_0_0_MemberCurrent
--     WHERE group_uuid = '6a4f2b1e-0000-5000-8000-000000000001'
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
--     WHERE group_uuid = '6a4f2b1e-0000-5000-8000-000000000001'
--     GROUP BY entity_reference
--     HAVING argMaxMerge(event_type) = 'added'
--        AND argMaxMerge(inactive) = 0
-- );

-- Reverse lookup: groups for a member. group_uuid is what the caller hands MongoDB (_uuid).
-- SELECT group_uuid, argMaxMerge(group_id) AS group_id
-- FROM fhir.Group_4_0_0_MemberCurrentByEntity
-- WHERE entity_reference = 'Patient/123'
-- GROUP BY group_uuid
-- HAVING argMaxMerge(event_type) = 'added'
--    AND argMaxMerge(inactive) = 0;

-- Full event history for a member in a group (care gap timeline)
-- SELECT
--     event_type, event_time, event_id,
--     period_start, period_end, inactive,
--     actor, reason, source, correlation_id
-- FROM fhir.Group_4_0_0_MemberEvents
-- WHERE group_uuid = '6a4f2b1e-0000-5000-8000-000000000001'
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
