CREATE TABLE IF NOT EXISTS fhir.fhir_audit_event (
    mongo_id        String,
    resource_id     String,
    recorded        DateTime64(3, 'UTC'),
    type_code       LowCardinality(String),
    action          LowCardinality(String),
    outcome         LowCardinality(String),
    agent_who       String,
    source_observer String,
    entity_what     String,
    access_tag      LowCardinality(String),
    owner_tag       LowCardinality(String),
    raw             String CODEC(ZSTD(7))
) ENGINE = ReplacingMergeTree()
ORDER BY (recorded, resource_id, mongo_id)
PARTITION BY toYYYYMM(recorded)
TTL recorded + INTERVAL 1 YEAR TO VOLUME 'cold'
SETTINGS storage_policy = 'tiered';
