-- Test-only ClickHouse table for ScaffoldingTestResource
-- Used by EA-2193 integration tests. NOT a real FHIR resource.
-- Exercises all column types the generic infrastructure supports.

CREATE DATABASE IF NOT EXISTS fhir;

CREATE TABLE IF NOT EXISTS fhir.fhir_scaffolding_test
(
    -- Identity
    id                           String,
    _uuid                        String,
    _sourceId                    String,

    -- Datetime column (required filter target)
    recorded                     DateTime64(3, 'UTC'),

    -- LowCardinality columns
    type_code                    LowCardinality(String),
    status                       LowCardinality(String),

    -- Reference column
    subject_reference            String,

    -- Number column
    value_quantity               Nullable(Float64),

    -- Security / multi-tenancy (mandatory per schema contract)
    access_tags                  Array(String) DEFAULT [],
    source_assigning_authority   LowCardinality(String) DEFAULT '',

    -- Full FHIR resource as JSON string (ZSTD compressed)
    _fhir_resource               String CODEC(ZSTD(3)),

    -- Bloom filter indexes for array searches
    INDEX idx_access_tags access_tags TYPE bloom_filter(0.01) GRANULARITY 4
)
ENGINE = MergeTree()
ORDER BY (recorded, id)
PARTITION BY toYYYYMM(recorded);
