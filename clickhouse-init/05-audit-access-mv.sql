-- ===========================================================================
-- Table: fhir.AUDIT_ACCESS_AGG (Access History Aggregation)
-- ===========================================================================
-- Pre-aggregated view of AuditEvent access patterns per entity and requesting agent.
-- Supports "who accessed what resource and when" queries for Access History.
-- One logical row per (entity_ref, agent_requestor_who, entity_resource_type, recorded_date)
-- after background merges complete.
--
-- Source: fhir.AuditEvent_4_0_0 (via AUDIT_ACCESS_MV)
-- Engine: AggregatingMergeTree (merges partial aggregate states on background compaction)
-- Granularity: daily, so the rolling ACCESS_HISTORY_WINDOW_DAYS window can be applied at day
--   precision (a monthly bucket would pull in up to a month of accesses older than the window)
-- Partition: Monthly by recorded_date (aligns with AuditEvent source partitioning)
-- TTL: 13 months (access history retention window)
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
    -- UTC day on which the access occurred
    recorded_date        Date,
    -- Number of times this agent accessed this entity on this day
    access_count         AggregateFunction(count),
    -- Most recent access timestamp for this agent + entity + day
    last_accessed        AggregateFunction(max, DateTime64(3, 'UTC')),
    -- Distinct set of purposeOfEvent codes ('system|code' format)
    purpose_of_events    AggregateFunction(groupUniqArray, String)
)
ENGINE = AggregatingMergeTree()
ORDER BY (entity_ref, agent_requestor_who, entity_resource_type, recorded_date)
PARTITION BY toYYYYMM(recorded_date)
TTL recorded_date + INTERVAL 13 MONTH;

-- ===========================================================================
-- MV: fhir.AUDIT_ACCESS_MV (Populates AUDIT_ACCESS_AGG from AuditEvent inserts)
-- ===========================================================================
-- Triggers synchronously on every INSERT into fhir.AuditEvent_4_0_0.
-- Explodes entity_what array (one row per referenced entity) and aggregates
-- access counts, last access time, and purpose-of-event codes per day.
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
    toDate(recorded) AS recorded_date,
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
GROUP BY entity_ref, agent_requestor_who, entity_resource_type, recorded_date;
