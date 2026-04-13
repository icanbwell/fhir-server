CREATE TABLE IF NOT EXISTS fhir.fhir_access_logs (
    mongo_id        String,
    timestamp       DateTime64(3, 'UTC'),
    method          LowCardinality(String),
    url             String,
    resource_type   LowCardinality(String),
    operation       LowCardinality(String),
    duration        UInt32,
    outcome         LowCardinality(String),
    agent_alt_id    String,
    network_address String,
    request_id      String,
    raw             String CODEC(ZSTD(7))
) ENGINE = ReplacingMergeTree()
ORDER BY (timestamp, mongo_id)
PARTITION BY toYYYYMM(timestamp)
TTL timestamp + INTERVAL 1 YEAR TO VOLUME 'cold'
SETTINGS storage_policy = 'tiered';
