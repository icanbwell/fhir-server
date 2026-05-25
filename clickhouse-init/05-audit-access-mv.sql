-- ===========================================================================
-- Table: fhir.AUDIT_ACCESS_AGG (Access History Aggregation)
-- ===========================================================================
-- Pre-aggregated view of AuditEvent access patterns per entity and requesting agent.
-- Supports "who accessed what resource and when" queries for Access History.
-- One logical row per (entity_ref, agent_requestor_who, entity_resource_type, recorded_month)
-- after background merges complete.
--
-- Source: fhir.AuditEvent_4_0_0 (via AUDIT_ACCESS_MV)
-- Engine: AggregatingMergeTree (merges partial aggregate states on background compaction)
-- Partition: Monthly by recorded_month (aligns with AuditEvent source partitioning)
-- TTL: 120 days (access history retention window)
--
-- Columns use AggregateFunction types — query with -Merge combinators:
--   access_count      → countMerge(access_count)
--   last_accessed     → maxMerge(last_accessed)
--   purpose_of_events → groupUniqArrayMerge(purpose_of_events)
--
-- NOTE: purpose_of_events stores a sentinel empty string ('') for events with
-- no purposeOfEvent. Filter at query time:
--   arrayFilter(x -> x != '', groupUniqArrayMerge(purpose_of_events))

CREATE TABLE IF NOT EXISTS fhir.AUDIT_ACCESS_AGG (
    -- Entity that was accessed (e.g. 'Patient/123', 'Observation/456')
    entity_ref           String,
    -- Agent who initiated the request (from AuditEvent.agent where requestor=true)
    agent_requestor_who  String,
    -- FHIR resource type extracted from entity_ref (e.g. 'Patient', 'Observation')
    entity_resource_type LowCardinality(String),
    -- First day of the month in which the access occurred
    recorded_month       DateTime,
    -- Number of times this agent accessed this entity in this month
    access_count         AggregateFunction(count),
    -- Most recent access timestamp for this agent + entity + month
    last_accessed        AggregateFunction(max, DateTime64(3, 'UTC')),
    -- Distinct set of purposeOfEvent codes ('system|code' format)
    purpose_of_events    AggregateFunction(groupUniqArray, String)
)
ENGINE = AggregatingMergeTree()
ORDER BY (entity_ref, agent_requestor_who, entity_resource_type, recorded_month)
PARTITION BY toYYYYMM(recorded_month)
TTL recorded_month + INTERVAL 120 DAY;

-- ===========================================================================
-- MV: fhir.AUDIT_ACCESS_MV (Populates AUDIT_ACCESS_AGG from AuditEvent inserts)
-- ===========================================================================
-- Triggers synchronously on every INSERT into fhir.AuditEvent_4_0_0.
-- Explodes entity_what array (one row per referenced entity) and aggregates
-- access counts, last access time, and purpose-of-event codes per month.
--
-- Filters:
--   - Excludes events with no requestor agent (agent_requestor_who = '')
--   - Excludes events with empty entity_what (ARRAY JOIN drops empty arrays)
--
-- Purpose-of-event handling:
--   - Extracts from purpose_of_event Array(Tuple(system, code)) column
--   - Concatenates as 'system|code' strings
--   - Defaults to PATRQT (Patient Requested) when no purposeOfEvent is present

CREATE MATERIALIZED VIEW IF NOT EXISTS fhir.AUDIT_ACCESS_MV
TO fhir.AUDIT_ACCESS_AGG
AS
SELECT
    entity_ref,
    agent_requestor_who,
    splitByChar('/', entity_ref)[1] AS entity_resource_type,
    toStartOfMonth(recorded) AS recorded_month,
    countState() AS access_count,
    maxState(recorded) AS last_accessed,
    groupUniqArrayState(
        arrayJoin(
            if(
                empty(purpose_of_event),
                ['http://terminology.hl7.org/CodeSystem/v3-ActReason|PATRQT'],
                arrayMap(t -> concat(t.1, '|', t.2), purpose_of_event)
            )
        )
    ) AS purpose_of_events
FROM fhir.AuditEvent_4_0_0
ARRAY JOIN entity_what AS entity_ref
WHERE agent_requestor_who != ''
GROUP BY entity_ref, agent_requestor_who, entity_resource_type, recorded_month;
