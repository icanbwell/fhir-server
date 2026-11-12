-- History table for FHIR resource versions (all resource types in one table).
-- ReplacingMergeTree dedups at-least-once deliveries on the ORDER BY key;
-- read with FINAL to collapse duplicates before merges have run.
-- Current resources stay in MongoDB; this table only holds prior versions.

CREATE TABLE IF NOT EXISTS fhir.Resource_4_0_0_History (
    resource_type                LowCardinality(String),
    _uuid                        String,
    _recorded                    DateTime64(3, 'UTC'),
    version_id                   String,

    -- Flat security tag array for generic hasAny() queries
    access_tags                  Array(String),

    -- Full FHIR resource version as Native JSON
    raw                          JSON(max_dynamic_paths=256)
)
ENGINE = ReplacingMergeTree()
ORDER BY (resource_type, _uuid, _recorded, version_id)
PARTITION BY toYYYYMM(_recorded)
-- Only the listed types expire (13 months). Every other type, including Consent and Group, is kept
-- indefinitely, so a type missing from this list is retained rather than deleted.
TTL toDateTime(_recorded) + INTERVAL 13 MONTH DELETE WHERE resource_type IN (
    'Composition', 'MedicationStatement', 'ExplanationOfBenefit', 'Provenance',
    'Observation', 'AllergyIntolerance', 'Person', 'Patient',
    'QuestionnaireResponse', 'Condition', 'Schedule', 'DocumentReference',
    'Binary', 'Coverage', 'SubscriptionStatus', 'Task',
    'CoverageEligibilityResponse', 'Specimen', 'Slot', 'ServiceRequest',
    'HealthcareService'
)
SETTINGS ttl_only_drop_parts = 1;
