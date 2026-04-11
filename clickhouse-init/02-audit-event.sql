-- AuditEvent table for FHIR AuditEvent resources
-- Lean schema: dedicated columns for frequently-queried fields,
-- full FHIR JSON in Native JSON `resource` column for all other queries.
-- See RFC: https://icanbwell.atlassian.net/wiki/x/IQBgbwE

CREATE TABLE IF NOT EXISTS fhir.AuditEvent_4_0_0 (
    -- Resource identifiers
    id                           String,
    _uuid                        String,

    -- Primary search param (MANDATORY in every query)
    recorded                     DateTime64(3, 'UTC'),

    -- Frequently filtered
    action                       LowCardinality(String),

    -- Reference search params (patient search + Access History)
    agent_who                    Array(String),
    agent_altid                  Array(String),
    entity_what                  Array(String),

    -- Agent requestor extraction (for Access History)
    agent_requestor_who          String,

    -- purposeOfEvent (for Access History — promoted from resource JSON)
    -- AuditEvent.purposeOfEvent[].coding[] → Array(Tuple(system, code))
    purpose_of_event             Array(Tuple(
                                     system LowCardinality(String),
                                     code LowCardinality(String)
                                 )),

    -- meta.security (access control + standard FHIR _security)
    meta_security                Array(Tuple(
                                     system LowCardinality(String),
                                     code LowCardinality(String)
                                 )),

    -- b.well internal columns
    _sourceAssigningAuthority    LowCardinality(String),
    _sourceId                    String,

    -- Full FHIR AuditEvent as Native JSON
    -- All remaining search params queryable via resource.{path}
    resource                     JSON(max_dynamic_paths=256),

    -- Skip indexes for array search columns
    INDEX idx_entity_what   entity_what   TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_agent_who     agent_who     TYPE bloom_filter(0.01) GRANULARITY 4
)
ENGINE = MergeTree()
ORDER BY (recorded, _uuid)
PARTITION BY toYYYYMM(recorded);
