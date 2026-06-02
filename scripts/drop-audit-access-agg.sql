-- ===========================================================================
-- DROP: fhir.AUDIT_ACCESS_MV and fhir.AUDIT_ACCESS_AGG
-- ===========================================================================
-- Removes the access history materialized view and its target aggregation table.
-- MV must be dropped first since it writes TO the target table.

DROP VIEW IF EXISTS fhir.AUDIT_ACCESS_MV;
DROP TABLE IF EXISTS fhir.AUDIT_ACCESS_AGG;
