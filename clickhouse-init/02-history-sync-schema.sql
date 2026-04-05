CREATE TABLE IF NOT EXISTS fhir.fhir_resource_history (
    resource_type   LowCardinality(String),
    resource_uuid   String,
    mongo_id        String,
    last_updated    DateTime64(3, 'UTC'),
    raw             String
) ENGINE = ReplacingMergeTree()
ORDER BY (resource_type, resource_uuid, last_updated, mongo_id)
PARTITION BY (resource_type, toYYYYMM(last_updated));
