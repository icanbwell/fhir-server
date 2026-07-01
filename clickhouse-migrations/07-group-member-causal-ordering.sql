-- ClickHouse migration 07 (EA-2326): causal ordering for Group membership current-state.
--
-- Adds version_id + batch_seq to the Group member event log and rebuilds the derived current-state
-- tables + materialized views so the argMax tie-break is (version_id, batch_seq, event_time,
-- event_id). This makes a causally-later add/remove for the same member win even when event_time
-- ties (the BUG-4 hazard, aggravated by EA-2323's deterministic event_time). See ADR 0004.
--
-- Idempotency (ADR 0003) is preserved: version_id and batch_seq are deterministic per committed
-- write, so a retried write still produces identical rows and argMax converges.
--
-- Run once per cluster, ideally during a quiet window. The AggregateFunction column TYPE changes,
-- which cannot be ALTERed in place, so the current-state tables + MVs are dropped and rebuilt, then
-- backfilled from the append-only event log (the source of truth). Existing event rows take
-- version_id = 0 / batch_seq = 0 via the column DEFAULTs; this only affects ordering AMONG
-- pre-migration events (which already resolved by event_time/event_id), not post-migration
-- correctness. Groups-on-ClickHouse is dev-only today, so no production data is affected.

-- ---------------------------------------------------------------------------
-- 1) Event log: add the causal-ordering columns (metadata-only ALTER).
-- ---------------------------------------------------------------------------
ALTER TABLE fhir.Group_4_0_0_MemberEvents
    ADD COLUMN IF NOT EXISTS version_id UInt64 DEFAULT 0 AFTER event_id;
ALTER TABLE fhir.Group_4_0_0_MemberEvents
    ADD COLUMN IF NOT EXISTS batch_seq UInt32 DEFAULT 0 AFTER version_id;

-- ---------------------------------------------------------------------------
-- 2) Drop the derived current-state MVs + tables (AggregateFunction tuple type is changing).
--    Dropping the MVs first stops them writing into tables we are about to drop.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS fhir.Group_4_0_0_MemberCurrent_MV;
DROP VIEW IF EXISTS fhir.Group_4_0_0_MemberCurrentByEntity_MV;
DROP TABLE IF EXISTS fhir.Group_4_0_0_MemberCurrent;
DROP TABLE IF EXISTS fhir.Group_4_0_0_MemberCurrentByEntity;

-- ---------------------------------------------------------------------------
-- 3) Recreate current-state tables with the widened tie tuple
--    (version_id, batch_seq, event_time, event_id). Mirrors clickhouse-init/01-init-schema.sql.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fhir.Group_4_0_0_MemberCurrent
(
    group_id String,
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
    group_source_assigning_authority AggregateFunction(argMax, String, Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),
    access_tags AggregateFunction(argMax, Array(String), Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),
    owner_tags  AggregateFunction(argMax, Array(String), Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID))
)
ENGINE = AggregatingMergeTree
ORDER BY (group_id, entity_reference);

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
        version_id,
        batch_seq,
        tuple(version_id, batch_seq, event_time, event_id) AS tie
    FROM fhir.Group_4_0_0_MemberEvents
)
GROUP BY group_id, entity_reference;

CREATE TABLE IF NOT EXISTS fhir.Group_4_0_0_MemberCurrentByEntity
(
    entity_reference String,
    group_id String,
    entity_reference_uuid AggregateFunction(argMax, String, Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),
    entity_reference_source_id AggregateFunction(argMax, String, Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),

    event_type AggregateFunction(argMax, Enum8('added' = 1, 'removed' = 2), Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),
    inactive   AggregateFunction(argMax, UInt8, Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),

    access_tags AggregateFunction(argMax, Array(String), Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID)),
    owner_tags  AggregateFunction(argMax, Array(String), Tuple(UInt64, UInt32, DateTime64(3, 'UTC'), UUID))
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
        version_id,
        batch_seq,
        tuple(version_id, batch_seq, event_time, event_id) AS tie
    FROM fhir.Group_4_0_0_MemberEvents
)
GROUP BY entity_reference, group_id;

-- ---------------------------------------------------------------------------
-- 4) Backfill the rebuilt current-state tables from the full event history.
--    The MVs above only process NEW inserts, so replay existing events once by inserting the
--    aggregate states directly into the target tables (this does not re-trigger the MVs, which
--    fire on inserts to the source event log, not the targets). Re-running is safe: argMax of
--    duplicate states is the same value, so a re-applied backfill does not change results.
-- ---------------------------------------------------------------------------
INSERT INTO fhir.Group_4_0_0_MemberCurrent
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
        *,
        tuple(version_id, batch_seq, event_time, event_id) AS tie
    FROM fhir.Group_4_0_0_MemberEvents
)
GROUP BY group_id, entity_reference;

INSERT INTO fhir.Group_4_0_0_MemberCurrentByEntity
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
        *,
        tuple(version_id, batch_seq, event_time, event_id) AS tie
    FROM fhir.Group_4_0_0_MemberEvents
)
GROUP BY entity_reference, group_id;

SELECT 'Migration 07 applied: Group membership current-state rebuilt with (version_id, batch_seq, event_time, event_id) tie-break' AS status;
