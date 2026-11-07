-- Migration: fhir.Resource_4_0_0_History table-wide 13-month TTL -> per-type TTL
-- 08-resource-history.sql is CREATE ... IF NOT EXISTS, so editing it does not change a table that
-- already exists. Run this against every environment that already has the table (dev, staging,
-- prod cloud table, persistent local volumes). Keep the type list identical to 08-resource-history.sql.
--
-- Step 1: the statement below sets the new TTL. Re-runnable; it only changes table metadata and
-- applies to parts written from now on. Rows already deleted by the old TTL are not restored.
-- Step 2: run once, by hand, after step 1: ALTER TABLE fhir.Resource_4_0_0_History MATERIALIZE TTL
-- It applies the TTL to existing parts and rewrites them.

ALTER TABLE fhir.Resource_4_0_0_History
MODIFY TTL toDateTime(_recorded) + INTERVAL 13 MONTH DELETE WHERE resource_type IN (
    'Composition', 'MedicationStatement', 'ExplanationOfBenefit', 'Provenance',
    'Observation', 'AllergyIntolerance', 'Person', 'Patient',
    'QuestionnaireResponse', 'Condition', 'Schedule', 'DocumentReference',
    'Binary', 'Coverage', 'SubscriptionStatus', 'Task',
    'CoverageEligibilityResponse', 'Specimen', 'Slot', 'ServiceRequest',
    'HealthcareService'
);
