-- Migration: AUDIT_ACCESS_AGG monthly → daily buckets (DCON-6108)
-- Fixes: $access-history returned accesses older than ACCESS_HISTORY_WINDOW_DAYS because the
--        aggregate was bucketed by month, so the window could only start at the first of the
--        month containing the cutoff (up to ~31 extra days).
-- Changes: recorded_month DateTime (toStartOfMonth(recorded)) → recorded_date Date (toDate(recorded))
--
-- AggregatingMergeTree sort keys and MV SELECTs can't be altered in place, so the MV and the
-- aggregate are dropped and recreated from clickhouse-init/05-audit-access-mv.sql.
-- Existing access history is not backfilled: the new aggregate only covers AuditEvents inserted
-- after Step 3, so $access-history starts empty and fills up as new accesses are recorded.
--
-- Run each step against ClickHouse manually in order.

-- Step 1: Drop the MV first so nothing writes into the old aggregate while it is dropped.
DROP VIEW IF EXISTS fhir.AUDIT_ACCESS_MV;

-- Step 2: Drop the old monthly aggregate.
DROP TABLE IF EXISTS fhir.AUDIT_ACCESS_AGG;

-- Step 3: Recreate the daily aggregate and MV from the checked-in DDL (not duplicated here so
-- the two can't drift). From the fhir-server repo root:
--
--   node src/admin/scripts/applyClickHouseDDL.js --file clickhouse-init/05-audit-access-mv.sql --skip-database-creation
--
-- Verify the new schema:
-- SELECT name, type FROM system.columns
--     WHERE database = 'fhir' AND table = 'AUDIT_ACCESS_AGG' AND name = 'recorded_date';
