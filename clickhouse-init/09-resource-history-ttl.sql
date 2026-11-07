-- Moves an existing fhir.Resource_4_0_0_History table from the original table-wide 13-month TTL to
-- the per-type TTL declared in 08-resource-history.sql (08 is CREATE ... IF NOT EXISTS, so editing it
-- does not change a table that already exists). Keep the type list identical to 08.
-- Safe to re-run: setting the same TTL again only rewrites table metadata. It affects parts written
-- from now on; run `ALTER TABLE fhir.Resource_4_0_0_History MATERIALIZE TTL` once, by hand, to apply
-- it to existing parts (it rewrites them, so it is not part of this re-runnable file). Rows already
-- deleted by the old TTL are not restored.

ALTER TABLE fhir.Resource_4_0_0_History
MODIFY TTL toDateTime(_recorded) + INTERVAL 13 MONTH DELETE WHERE resource_type IN (
    'Composition', 'MedicationStatement', 'ExplanationOfBenefit', 'Provenance',
    'Observation', 'AllergyIntolerance', 'Person', 'Patient',
    'QuestionnaireResponse', 'Condition', 'Schedule', 'DocumentReference',
    'Binary', 'Coverage', 'SubscriptionStatus', 'Task',
    'CoverageEligibilityResponse', 'Specimen', 'Slot', 'ServiceRequest',
    'HealthcareService'
);
