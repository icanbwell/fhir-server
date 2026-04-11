-- Migration: Add entity_reference_uuid and entity_reference_source_id columns
-- These store pre-save-enriched values from referenceGlobalIdHandler:
--   entity_reference_uuid: UUIDv5 deterministic hash (_uuid)
--   entity_reference_source_id: Plain resource reference without sourceAssigningAuthority (_sourceId)

-- ===========================================================================
-- Step 1: Add columns to event log table
-- ===========================================================================

ALTER TABLE fhir.fhir_group_member_events
    ADD COLUMN IF NOT EXISTS entity_reference_uuid String DEFAULT ''
    AFTER entity_reference;

ALTER TABLE fhir.fhir_group_member_events
    ADD COLUMN IF NOT EXISTS entity_reference_source_id String DEFAULT ''
    AFTER entity_reference_uuid;

-- ===========================================================================
-- Step 2: Add columns to current-state tables
-- ===========================================================================

ALTER TABLE fhir.fhir_group_member_current
    ADD COLUMN IF NOT EXISTS entity_reference_uuid AggregateFunction(argMax, String, Tuple(DateTime64(3, 'UTC'), UUID))
    AFTER entity_reference;

ALTER TABLE fhir.fhir_group_member_current
    ADD COLUMN IF NOT EXISTS entity_reference_source_id AggregateFunction(argMax, String, Tuple(DateTime64(3, 'UTC'), UUID))
    AFTER entity_reference_uuid;

ALTER TABLE fhir.fhir_group_member_current_by_entity
    ADD COLUMN IF NOT EXISTS entity_reference_uuid AggregateFunction(argMax, String, Tuple(DateTime64(3, 'UTC'), UUID))
    AFTER group_id;

ALTER TABLE fhir.fhir_group_member_current_by_entity
    ADD COLUMN IF NOT EXISTS entity_reference_source_id AggregateFunction(argMax, String, Tuple(DateTime64(3, 'UTC'), UUID))
    AFTER entity_reference_uuid;

-- ===========================================================================
-- Step 3: Recreate materialized views to include new columns
-- ===========================================================================
-- Materialized views must be dropped and recreated because ALTER VIEW
-- does not support changing the SELECT query in ClickHouse.
-- New events inserted after this migration will populate the new columns.

DROP VIEW IF EXISTS fhir.mv_group_member_current;

CREATE MATERIALIZED VIEW IF NOT EXISTS fhir.mv_group_member_current
TO fhir.fhir_group_member_current
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
    FROM fhir.fhir_group_member_events
)
GROUP BY group_id, entity_reference;

DROP VIEW IF EXISTS fhir.mv_group_member_current_by_entity;

CREATE MATERIALIZED VIEW IF NOT EXISTS fhir.mv_group_member_current_by_entity
TO fhir.fhir_group_member_current_by_entity
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
    FROM fhir.fhir_group_member_events
)
GROUP BY entity_reference, group_id;

SELECT 'Migration 02: entity_reference_uuid and entity_reference_source_id columns added' AS status;
