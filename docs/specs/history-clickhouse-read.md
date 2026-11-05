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

The loader must also disable date inference when it writes `raw`:
`input_format_try_infer_datetimes=0` and `input_format_try_infer_dates=0`. With the defaults, the JSON
column stores any string that looks like a fractional-second timestamp as `DateTime64(9)` and returns it
padded to nanoseconds (`…995Z` becomes `…995000000Z`, `+00:00` becomes `Z`), so reads would differ from
MongoDB. Checked against a local ClickHouse; not yet confirmed for ClickPipes.

## Supported and not supported (flag on)

Examples use a synthetic uuid `11111111-1111-4111-8111-111111111111`. All need an `access/*.read` (or
`access/*.*`) scope.

| Request | Result |
|---|---|
| `GET /4_0_0/Patient/{uuid}/_history` | Supported. Newest first, first page of `_count` (default 100). |
| `GET /4_0_0/Patient/{uuid}/_history?_count=50` | Supported. Capped at `RESOURCE_HISTORY_CLICKHOUSE_MAX_PAGE_SIZE`. |
| `GET /4_0_0/Patient/{uuid}/_history?_historyCursor=<token>` | Supported. Token from the previous `next` link. |
| `GET /4_0_0/Patient/{uuid}/_history?_since=2026-01-01T00:00:00Z` | Supported. Versions recorded at or after it. |
| `GET /4_0_0/Patient/{uuid}/_history/2` | Supported. One version; 404 if not in ClickHouse. |
| `GET /4_0_0/Patient/_history` | Supported. History of every `Patient`, paged by cursor; slow without `_since` on large types. |
| `GET /4_0_0/Patient/_history?_since=2026-01-01&_count=100` | Supported. Bounded type-level read. |
| `GET /4_0_0/Patient/{uuid}/_history?_metaUuid=1` | Supported. `_metaUuid` is accepted (sent by fhir-server-ui). |
| `GET /4_0_0/Patient/abc/_history` | 400. The id is not a uuid (a source id). |
| `GET /4_0_0/Patient/abc\|client-1/_history` | 400. The `id\|owner` form is not a uuid. |
| `GET /4_0_0/Patient/{uuid}/_history?_uuid={uuid}` | 400. There is no `_uuid` parameter; the URL id is the uuid. |
| `GET /4_0_0/Patient/_history?_id={uuid}` or `?id=` | 400. An id filter on a type-level read would be ignored. |
| `GET /4_0_0/Patient/{uuid}/_history?_lastUpdated=gt2026-01-01` | 400. Unsupported arguments are rejected, not dropped. |
| `GET /4_0_0/Patient/{uuid}/_history?_since=yesterday` | 400. `_since` must be an ISO 8601 date or instant. |
| `GET /4_0_0/Patient/{uuid}/_history/2?_since=2026-01-01` | 400. `_since` is not supported on a single-version read. |
| `GET /4_0_0/Patient/{uuid}/_history?_historyCursor=garbage` | 400. Invalid cursor. |
| `GET /4_0_0/Patient/{uuid}/_history` with a tenant scope (`access/client-1.read`) | 403. Needs a non-tenant `access/*` scope. |
| `GET /4_0_0/Patient/{uuid}/_history` with a `patient/*` scope | 403. |
| `GET /4_0_0/Group/{uuid}/_history` or `GroupMember` | Not supported. Do not enable these types (13-month retention). |
| Versions older than 13 months, or a version stored in cloud storage | Not returned (404 for a version read), or 500 for a cloud storage stub. |
| ClickHouse error or timeout | 500. No MongoDB fallback. |
| A type not in the flag list | Unchanged: MongoDB; none of the rules above apply. |

## Request contract (flag on)

- The URL `{id}` must be the resource `_uuid` (checked with `isUuid`): `/{type}/{uuid}/_history` and
  `/{type}/{uuid}/_history/{versionId}`. There is no `_uuid` query parameter. A request whose id is
  not a uuid (a source id or `id|owner`) is rejected with 400 before any query runs. No id-to-uuid
  lookup is done, so there is no MongoDB read. The resource type comes from the route, so no scan
  across resource types is possible.
- Type-level `/{type}/_history` (no id) is also served: it pages through the history of every
  resource of the type, newest first (`_recorded DESC, _uuid DESC, version DESC`), with the same
  keyset cursor (which also carries the last row's `_uuid`). `id`/`_id` arguments are rejected with
  400. It has no time window, so each page scans the type's history in `_recorded` order (the table
  is ordered by `resource_type, _uuid`); it can be slow on large types and is bounded only by
  `CLICKHOUSE_REQUEST_TIMEOUT`. Access is the same as instance history: only non-tenant `access/*`
  scopes pass, with no `access_tags` predicate.
- Arguments the read cannot honour (for example `_lastUpdated`) are rejected with 400 instead of being
  dropped. `_historyCursor` is accepted only for flagged resource types, and are not
  added to the global strict-mode allow-list.
- A history entry that was moved to cloud storage (a stub) cannot be served from ClickHouse and
  fails with 500.
- `_count` is the page size; it defaults to `DB_SEARCH_LIMIT` (100) and is capped by
  `RESOURCE_HISTORY_CLICKHOUSE_MAX_PAGE_SIZE` (default 100).
- `_since` (optional, instance and type-level) is an ISO 8601 date or instant; only versions recorded
  (`_recorded`) at or after it are returned. It bounds the scan of a type-level read. Not a valid
  date, or repeated: 400. Not supported on a single-version read (400). It stays in the `next` link.
- `_historyCursor` is the opaque continuation token from the previous page's `next` link.
- `_history/{versionId}` reads one version by `version_id`; 404 when it is not in ClickHouse.

## Query

```sql
SELECT raw, _uuid AS row_uuid, toUnixTimestamp64Milli(_recorded) AS recorded_ms, toUInt64OrZero(version_id) AS version_number
FROM fhir.Resource_4_0_0_History FINAL
WHERE resource_type = {resource_type:String}
  [AND _uuid = {uuid:String}]                                   -- instance read only
  [AND _recorded >= fromUnixTimestamp64Milli({since_ms:Int64}, 'UTC')]   -- _since
  [AND (_recorded, [_uuid,] toUInt64OrZero(version_id)) < (...)]         -- cursor; _uuid only type-level
ORDER BY _recorded DESC, [_uuid DESC,] toUInt64OrZero(version_id) DESC
LIMIT {limit:UInt32}
```

The page asks for `limit + 1` rows; an extra row means a `next` link. The cursor is
`base64url(JSON {r: _recorded epoch ms, v: version number[, u: _uuid]})` of the last returned row (`u` only for a type-level read), so pages have no
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

- Timeout: reads use the shared client's `CLICKHOUSE_REQUEST_TIMEOUT` (default 3 minutes); there is no
  history-specific timeout setting. A read that exceeds it fails with a 500.
- Any ClickHouse error or timeout returns 500. There is no fallback to MongoDB; the per-type flag
  is the rollback.
- Versions older than the 13-month TTL are not in ClickHouse, so they are not returned (history is
  truncated, a version read returns 404).
- `Group` and `GroupMember` are not supported yet. The 13-month retention would truncate their
  history, and a Group's roster at a version is rebuilt from GroupMember history, so a truncated
  GroupMember history would return incomplete rosters. Do not add `Group` to
  `RESOURCE_HISTORY_CLICKHOUSE_READ_RESOURCES` until ClickHouse retention covers them (or the roster
  is served another way); support is planned for later.

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
