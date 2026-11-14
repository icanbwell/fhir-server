-- Migration: temporarily raise the active-parts limits on Resource_4_0_0_History
-- Why: the history backfill reaches this table through the resource-history ClickPipe in
--      small inserts (~20 MB each). Background merges can't keep up, so the October
--      partition (202610) is above parts_to_delay_insert, inserts are being delayed, and at
--      the current growth rate it would reach parts_to_throw_insert ("Too many parts") and
--      stop ingestion. Raising the limits keeps inserts flowing while merges catch up.
-- Changes: table-level override only (the service defaults are 1000 / 3000):
--      parts_to_delay_insert 1000 -> 2000, parts_to_throw_insert 3000 -> 5000.
--      max_parts_in_total (10000, set by ClickHouse Cloud) is not changed, so keep
--      parts_to_throw_insert well below it.
-- Trade-off: more active parts make history reads (which use FINAL) slower in the affected
--      partition. This is a temporary safety margin; revert it with Step 4 once the backlog
--      has drained.
--
-- Not part of clickhouse-init: 08-resource-history.sql uses CREATE TABLE IF NOT EXISTS and
-- does not change an existing table, and these limits are not meant to be permanent.
--
-- Run each step against ClickHouse manually in order.

-- Step 1: Check the current parts per partition and the effective limits.
SELECT partition, count() AS active_parts
FROM clusterAllReplicas('default', system.parts)
WHERE database = 'fhir' AND table = 'Resource_4_0_0_History' AND active
GROUP BY partition
ORDER BY partition DESC;

SELECT name, value, changed
FROM system.merge_tree_settings
WHERE name IN ('parts_to_delay_insert', 'parts_to_throw_insert', 'max_parts_in_total');

-- Step 2: Raise the limits on this table only.
ALTER TABLE fhir.Resource_4_0_0_History
    MODIFY SETTING parts_to_delay_insert = 2000, parts_to_throw_insert = 5000;

-- Step 3: Verify. The SETTINGS clause should now list both values next to
-- ttl_only_drop_parts = 1.
SHOW CREATE TABLE fhir.Resource_4_0_0_History;

-- Step 4 (revert, once every partition is back below ~1000 active parts):
-- ALTER TABLE fhir.Resource_4_0_0_History
--     RESET SETTING parts_to_delay_insert, parts_to_throw_insert;
