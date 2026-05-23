-- ClickHouse table for FHIR Observation resources (wearable device telemetry)
--
-- ReplacingMergeTree with meta_version_id for at-least-once delivery dedup.
-- Read queries use LIMIT 1 BY dedupKey to get the latest version per
-- logical reading without FINAL's query-time merge cost.
--
-- Optimized for the canonical query: patient + metric + date range.
-- ORDER BY matches this access pattern for efficient range scans.

CREATE DATABASE IF NOT EXISTS fhir;

CREATE TABLE IF NOT EXISTS fhir.Observation_4_0_0
(
    -- Identity
    id                           String,
    _uuid                        String,
    _sourceId                    String,

    -- Version for ReplacingMergeTree dedup
    -- Parsed from FHIR meta.versionId (always set by the FHIR server).
    -- Higher version wins on merge. Deterministic per logical reading.
    meta_version_id              UInt64 DEFAULT 0,

    -- Core search parameter columns (dedicated for fast columnar filtering)
    effective_datetime           DateTime64(3, 'UTC'),
    code_code                    LowCardinality(String),
    code_system                  LowCardinality(String),
    category_code                LowCardinality(String),
    status                       LowCardinality(String),
    subject_reference            String,
    device_reference             String DEFAULT '',
    encounter_reference          String DEFAULT '',

    -- Value columns (vital signs: typically valueQuantity)
    value_quantity_value         Nullable(Float64),
    value_quantity_unit          LowCardinality(String) DEFAULT '',
    value_quantity_code          LowCardinality(String) DEFAULT '',

    -- BP component columns (code 85354-9: Blood pressure panel)
    -- Systolic: code 8480-6, Diastolic: code 8462-4
    component_systolic           Nullable(Float64),
    component_diastolic          Nullable(Float64),

    -- Security / multi-tenancy (mandatory per schema contract)
    access_tags                  Array(String) DEFAULT [],
    owner_tags                   Array(String) DEFAULT [],
    source_assigning_authority   LowCardinality(String) DEFAULT '',

    -- Meta
    meta_last_updated            DateTime64(3, 'UTC') DEFAULT now64(3, 'UTC'),
    meta_source                  String DEFAULT '',

    -- Full FHIR resource (ZSTD compressed, only read for response reconstruction)
    -- Dedicated columns above are for filtering. This column is the source of truth
    -- for the complete FHIR Observation resource.
    _fhir_resource               String CODEC(ZSTD(3)),

    -- Bloom filter indexes for array searches
    INDEX idx_access_tags access_tags TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_owner_tags  owner_tags  TYPE bloom_filter(0.01) GRANULARITY 4
)
ENGINE = ReplacingMergeTree(meta_version_id)
ORDER BY (subject_reference, code_code, effective_datetime, id)
PARTITION BY toYYYYMM(effective_datetime);
