# `_history` reads from ClickHouse

## Goal

Serve `_history` and `_history/{versionId}` reads from `fhir.Resource_4_0_0_History` instead of
MongoDB, one resource type at a time, so the MongoDB history write can later be switched off.
Default is off; behaviour is unchanged until a type is listed.

## Switch

`RESOURCE_HISTORY_CLICKHOUSE_READ_RESOURCES` (comma-separated resource types). Empty (default) is
off; a listed type reads from ClickHouse; unlisted types read from MongoDB as today. Read from the
environment per call, so changing it is a config rollout. Enable a type only once its history is
complete in ClickHouse (backfill done, ClickPipe running).

## Request contract (flag on)

- `_uuid` is required. A request without it is rejected with 400 before any query runs. The URL
  `id` is not used to look anything up, so there is no MongoDB read. The resource type comes from the
  route. No scan across resource types or across all ids is possible.
- The URL `id` must match the resource `_uuid` points to (`id`, `_uuid` or `_sourceId` of the returned
  entries); otherwise 404, so a URL can never return another resource's history.
- Arguments the read cannot honour (for example `_lastUpdated`) are rejected with 400 instead of being
  dropped. `_uuid` and `_historyCursor` are accepted only for flagged resource types, and are not
  added to the global strict-mode allow-list.
- A history entry that was moved to cloud storage (a stub) cannot be served from ClickHouse and
  fails with 500.
- `_count` is the page size; it defaults to `DB_SEARCH_LIMIT` (100) and is capped by
  `RESOURCE_HISTORY_CLICKHOUSE_MAX_PAGE_SIZE` (default 100).
- `_historyCursor` is the opaque continuation token from the previous page's `next` link.
- `_history/{versionId}` reads one version by `version_id`; 404 when it is not in ClickHouse.

## Query

```sql
SELECT raw
FROM fhir.Resource_4_0_0_History FINAL
WHERE resource_type = {resource_type:String} AND _uuid = {uuid:String}
  [AND (_recorded, toUInt64OrZero(version_id)) < ({recorded:DateTime64(3, 'UTC')}, {version:UInt64})]
ORDER BY _recorded DESC, toUInt64OrZero(version_id) DESC
LIMIT {limit:UInt32}
```

The page asks for `limit + 1` rows; an extra row means a `next` link. The cursor is
`base64url(JSON {r: _recorded epoch ms, v: version number})` of the last returned row, so pages have no
gaps or duplicates even when new versions are written between requests. No `access_tags`
predicate: history reads already require a non-tenant access scope (`hasHistoryAccess`), which
is checked before the query.

## Response

Same history Bundle as MongoDB. `raw` is the stored BundleEntry; `_recorded` is removed by the existing
Bundle serializer, as for MongoDB entries.
Entries get the same attachment/base64 transforms, `response` fill-in and enrichment as today. The
`next` link carries `_historyCursor` (and drops `_getpagesoffset`).

## Failure

- ClickHouse is the only source for a flagged type: a version whose Kafka produce failed or has not
  landed is missing. Enable a type only once its history is complete (backfill done, produce enabled).
- Queries set `output_format_json_quote_64bit_integers=0` so FHIR integers stay numbers.

- Per-query timeout: `RESOURCE_HISTORY_CLICKHOUSE_READ_TIMEOUT_MS` (default 10000), enforced by an
  abort signal and `max_execution_time`.
- Any ClickHouse error or timeout returns 500. There is no fallback to MongoDB; the per-type flag
  is the rollback.
- Versions older than the 13-month TTL are not in ClickHouse, so they are not returned (history is
  truncated, a version read returns 404).

## Observability

- OTel metrics by `resource_type`: `fhir_history_clickhouse_reads_total` (also `outcome`:
  `success`/`error`), `fhir_history_clickhouse_read_duration_seconds`,
  `fhir_history_clickhouse_read_rows`.
- Logs carry resource type, row count and duration only. Never `_uuid`, ids or payloads.

## Constraints

- Tenancy: no new access path around the scope checks; `hasHistoryAccess` and scope validation run
  before the query. The query is keyed on resource type and `_uuid`, never a scan.
- PHI: `raw` is PHI as in MongoDB; logs and metric labels never carry it.
- Not done: dev-environment verification against a populated ClickHouse.
