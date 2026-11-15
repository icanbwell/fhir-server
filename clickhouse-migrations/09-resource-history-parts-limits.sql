-- Migration: temporarily raise the active-parts limits on Resource_4_0_0_History
-- Why: the history backfill reaches this table through the resource-history ClickPipe, and
--      background merges can't keep up. The October partition (202610) is above
--      parts_to_throw_insert, so ClickHouse rejects inserts into it with TOO_MANY_PARTS
--      and the ClickPipe has to retry them. Raising the limits keeps inserts flowing while
--      merges catch up.
-- Changes: table-level override only (the service defaults are 1000 / 3000):
--      parts_to_delay_insert 1000 -> 2000, parts_to_throw_insert 3000 -> 5000.
--      max_parts_in_total (10000, set by ClickHouse Cloud) is not changed, so keep
--      parts_to_throw_insert well below it.
-- Trade-off: more active parts make history reads (which use FINAL) slower in the affected
--      partition. This is a temporary safety margin; revert it once the backlog has drained.
--
-- Not part of clickhouse-init: 08-resource-history.sql uses CREATE TABLE IF NOT EXISTS and
-- does not change an existing table, and these limits are not meant to be permanent.
--
-- Apply with the admin script (it runs every uncommented statement in this file, in order):
--   node src/admin/scripts/applyClickHouseDDL.js --file clickhouse-migrations/09-resource-history-parts-limits.sql
-- The script's ClickHouse user has no REMOTE grant, so this file must not contain
-- clusterAllReplicas() or other table functions that need it.
--
-- Before and after: check the parts per partition and the effective limits from the
-- ClickHouse Cloud console (an admin user). clusterAllReplicas returns each shared part once
-- per replica, so count unique part names; count() would multiply the real number by the
-- replica count.
--   SELECT partition, uniqExact(name) AS active_parts
--   FROM clusterAllReplicas('default', system.parts)
--   WHERE database = 'fhir' AND table = 'Resource_4_0_0_History' AND active
--   GROUP BY partition
--   ORDER BY partition DESC
--
--   SELECT name, value, changed
--   FROM system.merge_tree_settings
--   WHERE name IN ('parts_to_delay_insert', 'parts_to_throw_insert', 'max_parts_in_total')
--
-- Revert, once every partition is back below ~1000 active parts:
--   ALTER TABLE fhir.Resource_4_0_0_History
--       RESET SETTING parts_to_delay_insert, parts_to_throw_insert

-- Raise the limits on this table only.
ALTER TABLE fhir.Resource_4_0_0_History
    MODIFY SETTING parts_to_delay_insert = 2000, parts_to_throw_insert = 5000;

-- Verify. The SETTINGS clause should now list both values next to ttl_only_drop_parts = 1.
SHOW CREATE TABLE fhir.Resource_4_0_0_History;
