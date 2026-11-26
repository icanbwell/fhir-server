-- Migration: drop the audit-event migration progress table
-- fhir.audit_event_migration_state tracked per-hour progress of the audit-event migration.
--
-- DESTRUCTIVE and irreversible. Run only after confirming the audit-event migration is
-- finished (no rows with an in-progress status) and that you are in the intended environment.
-- Repeatable: safe to re-run.

DROP TABLE IF EXISTS fhir.audit_event_migration_state;
