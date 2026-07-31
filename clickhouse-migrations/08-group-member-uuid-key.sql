-- Migration: key the ClickHouse Group membership tables on group_uuid.
-- See ADR 0006 (docs/adr/0006-clickhouse-group-identity-uuid.md).
--
-- ############################################################################
-- ## DESTRUCTIVE. THIS MIGRATION PERMANENTLY DISCARDS EVERY GROUP ROSTER.    ##
-- ## DO NOT RUN IT AGAINST ANY CLUSTER SERVING TRAFFIC.                      ##
-- ############################################################################
--
-- PROBLEM
-- Every membership table keyed on group_id, the FHIR logical id, and per-Group queries narrowed on
-- it. That is a presentation field, not an identity:
--   - A client can choose it through update-as-create (PUT /Group/<id>), so it is unique only
--     WITHIN a tenant. Two tenants that pick the same id share one bucket: Group.quantity returns
--     the union of both rosters, the current-state AggregatingMergeTree rows collapse into one
--     (there the sorting key IS the aggregation key, so one tenant's state overwrites the other's),
--     and the update path -- which hydrates the current roster to diff against -- emits 'removed'
--     events for the other tenant's members.
--   - Enrichment rewrites resource.id on the read path before the count query runs
--     (IdEnrichmentProvider, then GlobalIdEnrichmentProvider under Prefer: global_id=true, which
--     sets id = _uuid). So a conformant read could query group_id = <uuid> against rows holding the
--     logical id and get quantity: 0 for a Group that has members.
--   - The reverse lookup hands ClickHouse's ids to MongoDB as an $in list. A composite
--     (group_id, authority) key degrades to one column at that boundary, and id is not
--     tenant-unique in MongoDB either.
--
-- FIX
-- group_uuid is the identity. It carries MongoDB's _uuid = uuidv5(id|sourceAssigningAuthority)
-- (UuidColumnHandler), which is already the key for AuditEvent in ClickHouse
-- (clickhouse-init/02-audit-event.sql) and for the Group compensation path
-- (src/utils/clickHouseGroupPreSave.js). One column, never mutated on the read path, and the same
-- value in every store. group_id and group_source_assigning_authority remain as payload for
-- provenance and debugging.
--
-- WHY DISCARD RATHER THAN BACKFILL
-- The event log's sorting key leads on the identity column, and a MergeTree ORDER BY cannot be
-- ALTERed in place, so the log is dropped and recreated. Recomputing group_uuid in SQL is not an
-- option: generateUUIDv5 does not exist in ClickHouse 26.2. The alternative is a Node-side
-- backfill -- read (group_id, group_source_assigning_authority) per row, compute
-- generateUUIDv5(`${group_id}|${gsaa}`) in Node, write it into a new column, verify zero
-- group_uuid = '', then rebuild the derived tables. That is the required path for any cluster whose
-- rosters matter. Discarding is chosen here because Groups-on-ClickHouse is not enabled for
-- production traffic and this service is the only writer, so the existing rows are dev/staging only
-- and re-seedable.
--
-- WHAT DISCARDING ACTUALLY COSTS
-- For Groups written with useExternalStorage, stripMembersIfNeeded removes the member array from the
-- MongoDB document (src/utils/clickHouseGroupPreSave.js), so ClickHouse holds the ONLY copy of the
-- roster; MongoDB keeps metadata only. After this migration those Group documents still exist but
-- read back quantity: 0 with no members, and nothing can reconstruct them. This is data loss, not a
-- no-op.
--
-- HOW TO RUN
-- Run each statement manually against ClickHouse, in order, so the pre-flight report in statement 1
-- can be read before the guard in statement 2 decides whether to proceed. Do not apply this file
-- with applyClickHouseDDL -- that runner splits on semicolons and does not stop between statements,
-- which is the wrong shape for a migration whose second statement exists to be read and then
-- deliberately authorized.
--
-- Statement 2 refuses to continue unless the operator has authorized the data loss. Read statement
-- 1's report first, then authorize with:
--
--   CREATE TABLE fhir.yes_truncate_group_members_dev (acknowledged UInt8) ENGINE = Memory
--
-- and re-run. The sentinel is dropped at the end, so authorization is single-use.

-- ---------------------------------------------------------------------------
-- 1) Pre-flight report: what this migration is about to discard.
-- ---------------------------------------------------------------------------
SELECT
    'ABOUT TO DISCARD' AS notice,
    uniqExact(group_id, group_source_assigning_authority) AS groups_affected,
    uniqExact(entity_reference) AS distinct_members,
    count() AS member_events
FROM fhir.Group_4_0_0_MemberEvents;

-- ---------------------------------------------------------------------------
-- 2) Guard: abort unless the operator explicitly authorized the data loss.
-- ---------------------------------------------------------------------------
SELECT throwIf(
    (SELECT count() FROM system.tables
     WHERE database = 'fhir' AND name = 'yes_truncate_group_members_dev') = 0,
    'Refusing to run migration 08: it permanently discards every Group roster, and ClickHouse is the only copy for useExternalStorage Groups. Never run this against a cluster serving traffic - use the Node-side backfill described in this file''s header. To authorize on a dev/staging cluster, create the sentinel table named in this file''s HOW TO RUN section, then re-run.'
) AS guard;

-- ---------------------------------------------------------------------------
-- 3) Drop the materialized views first so they stop writing into tables that
--    are about to be dropped, then the derived tables, then the event log.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS fhir.Group_4_0_0_MemberCurrent_MV;
DROP VIEW IF EXISTS fhir.Group_4_0_0_MemberCurrentByEntity_MV;
DROP TABLE IF EXISTS fhir.Group_4_0_0_MemberCurrent;
DROP TABLE IF EXISTS fhir.Group_4_0_0_MemberCurrentByEntity;
DROP TABLE IF EXISTS fhir.Group_4_0_0_MemberEvents;

-- ---------------------------------------------------------------------------
-- 4) Recreate the event log with group_uuid leading the sorting key.
--    Mirrors clickhouse-init/01-init-schema.sql.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fhir.Group_4_0_0_MemberEvents
(
    group_uuid String,
    group_id String,

    entity_reference String,
    entity_reference_uuid String DEFAULT '',
    entity_reference_source_id String DEFAULT '',
    entity_type LowCardinality(String),

    event_type Enum8('added' = 1, 'removed' = 2),
    event_time DateTime64(3, 'UTC') DEFAULT now64(3, 'UTC'),
    event_id UUID DEFAULT generateUUIDv4(),

    version_id UInt64 DEFAULT 0,
    batch_seq UInt32 DEFAULT 0,

    period_start Nullable(DateTime64(3, 'UTC')),
    period_end Nullable(DateTime64(3, 'UTC')),

    inactive UInt8 DEFAULT 0,

    actor String DEFAULT '',
    reason LowCardinality(String) DEFAULT '',
    source LowCardinality(String) DEFAULT '',
    correlation_id String DEFAULT '',

    group_source_id String DEFAULT '',
    group_source_assigning_authority String DEFAULT '',
    access_tags Array(String) DEFAULT [],
    owner_tags Array(String) DEFAULT [],

    source_assigning_authority LowCardinality(String) DEFAULT ''
)
ENGINE = MergeTree()
ORDER BY (group_uuid, entity_reference, event_time, event_id);

-- ---------------------------------------------------------------------------
-- 5) Recreate the derived current-state tables and their MVs, keyed on
--    group_uuid. group_id and group_source_assigning_authority become
--    latest-state provenance columns rather than key columns.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fhir.Group_4_0_0_MemberCurrent
(
    group_uuid String,
    group_id AggregateFunction(argMax, String, Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),
    group_source_assigning_authority AggregateFunction(argMax, String, Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),

    entity_reference String,
    entity_reference_uuid AggregateFunction(argMax, String, Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),
    entity_reference_source_id AggregateFunction(argMax, String, Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),

    entity_type AggregateFunction(argMax, LowCardinality(String), Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),

    event_type AggregateFunction(argMax, Enum8('added' = 1, 'removed' = 2), Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),
    event_time AggregateFunction(argMax, DateTime64(3, 'UTC'), Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),
    event_id   AggregateFunction(argMax, UUID, Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),

    period_start AggregateFunction(argMax, Nullable(DateTime64(3, 'UTC')), Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),
    period_end   AggregateFunction(argMax, Nullable(DateTime64(3, 'UTC')), Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),
    inactive     AggregateFunction(argMax, UInt8, Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),

    actor          AggregateFunction(argMax, String, Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),
    reason         AggregateFunction(argMax, LowCardinality(String), Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),
    source         AggregateFunction(argMax, LowCardinality(String), Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),
    correlation_id AggregateFunction(argMax, String, Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),

    group_source_id AggregateFunction(argMax, String, Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),
    access_tags AggregateFunction(argMax, Array(String), Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),
    owner_tags  AggregateFunction(argMax, Array(String), Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID))
)
ENGINE = AggregatingMergeTree
ORDER BY (group_uuid, entity_reference);

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

CREATE TABLE IF NOT EXISTS fhir.Group_4_0_0_MemberCurrentByEntity
(
    entity_reference String,
    group_uuid String,
    group_id AggregateFunction(argMax, String, Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),
    group_source_assigning_authority AggregateFunction(argMax, String, Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),

    entity_reference_uuid AggregateFunction(argMax, String, Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),
    entity_reference_source_id AggregateFunction(argMax, String, Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),

    event_type AggregateFunction(argMax, Enum8('added' = 1, 'removed' = 2), Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),
    inactive   AggregateFunction(argMax, UInt8, Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),

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

-- ---------------------------------------------------------------------------
-- 6) Revoke the authorization so a second run needs a fresh explicit act.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS fhir.yes_truncate_group_members_dev;

SELECT 'Migration 08 applied - Group membership keyed on group_uuid, all prior rosters discarded' AS status;
