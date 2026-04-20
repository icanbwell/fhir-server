-- AccessLog table for FHIR server HTTP access logs
-- Hybrid schema: full nested sub-objects (agent, details, request) as Native JSON
-- columns preserving the exact shape emitted by AccessLogger; lean flat mirrors
-- (agent_altId, origin_service, request_id) materialized from the JSON for
-- indexed point lookups.

CREATE TABLE IF NOT EXISTS fhir.AccessLog (
    timestamp                    DateTime64(3, 'UTC'),
    outcome_desc                 LowCardinality(String),

    -- Full nested sub-objects, preserved verbatim
    agent                        JSON(max_dynamic_paths=16),
    details                      JSON(max_dynamic_paths=64),
    request                      JSON(max_dynamic_paths=16),

    -- Lean, indexed mirrors of the most common filter keys.
    -- Populated by ClickHouse from the JSON columns at insert time.
    -- Native JSON subfields are Dynamic; toString() coerces them to match the column type.
    agent_altId                  String                 MATERIALIZED toString(agent.altId),
    origin_service               LowCardinality(String) MATERIALIZED toString(details.originService),
    request_id                   String                 MATERIALIZED toString(request.id),

    INDEX idx_request_id     request_id     TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_agent_altId    agent_altId    TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_origin_service origin_service TYPE bloom_filter(0.01) GRANULARITY 4
)
ENGINE = MergeTree()
ORDER BY timestamp
PARTITION BY toDate(timestamp)
TTL timestamp + INTERVAL 7 DAY DELETE;
