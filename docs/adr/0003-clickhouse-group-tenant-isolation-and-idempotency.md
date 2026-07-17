# Tenant Isolation and Idempotency for the ClickHouse Group Membership Path

## Status

Accepted (revises the EA-2323 Group ClickHouse hardening after review)

**Scope notes:**
- This ADR covers two decisions on the Group membership dual-write/read path (Group metadata in MongoDB, member events in ClickHouse), both surfaced by review of the initial EA-2323 hardening (commit `1847597f`):
  1. How tenant isolation is enforced on the ClickHouse Group reverse-lookup read (`GET /Group?member=...`), and specifically how a legitimate full-access (wildcard) admin is handled.
  2. How the Group member event insert achieves idempotency across retries, and why the ClickHouse `insert_deduplication_token` mechanism is deliberately not used.
- It does not change the MongoDB read/write paths, the FHIR contract, or the event schema. The ClickHouse schema (`clickhouse-init/01-init-schema.sql`) is unchanged.

## Context

The FHIR server stores `Group` resources with metadata in MongoDB and member add/remove events in ClickHouse (`fhir.Group_4_0_0_MemberEvents`, an append-only event log), with current state derived by `AggregatingMergeTree` materialized views that resolve to one logical row per member via `argMax` over the tuple `(event_time, event_id)`.

The initial EA-2323 hardening added two protections that review found to be incorrect:

### Problem 1 — the fail-closed tenant filter denied legitimate wildcard admins

`QueryBuilder._buildActiveMemberHavingClause` injected a `1 = 0` deny clause whenever both the access-tag and owner-tag arrays were empty, on the theory that an empty-tag query is unscoped and would otherwise leak cross-tenant rows. The accompanying comment claimed a wildcard admin "arrives here as a non-empty array (e.g. `['*']`)".

That claim is false. Tracing the platform security model:

- `ScopesManager.getAccessCodesFromScopes` (`src/operations/security/scopesManager.js`) parses `access/<tag>.<action>` scopes into access codes. A wildcard admin scope `access/*.*` yields the access code `*`.
- `SecurityTagManager.getSecurityTagsFromScope` (`src/operations/common/securityTagManager.js:55-73`) then: throws `ForbiddenError` (403) if there are no access codes and no patient scope; returns **empty** security tags if the codes include `*` (full access, so no tenant predicate is applied); otherwise returns the codes as tags.
- In `SearchManager.constructQueryAsync` (`src/operations/search/searchManager.js:280`), a `meta.security` predicate is only appended when `securityTags.length > 0`. A wildcard admin therefore produces a query with **no** security predicate.

So by the time a query reaches the ClickHouse provider, a legitimate `access/*.*` admin's query carries no tags — identical in tag-shape to a hypothetical unscoped caller. But a genuinely unscoped caller was already rejected with a 403 upstream and never reaches the provider. The `1 = 0` rule therefore force-denied exactly the admin it should have allowed, and inferred authorization from the absence of tags (which is not an authorization signal).

The write path (`QueryFragments.whereAccessTags` / `whereOwnerTags`, `src/utils/clickHouse/queryFragments.js:208-260`) already establishes the correct convention: it **throws** on empty tags rather than silently omitting the filter.

### Problem 2 — the dedup token is inert on this engine

The insert in `GroupMemberRepository.appendEvents` set `insert_deduplicate: 1` and a content-derived `insert_deduplication_token`, and the comments presented that token as the mechanism that makes retries safe.

`fhir.Group_4_0_0_MemberEvents` is a plain `MergeTree` (`clickhouse-init/01-init-schema.sql:53-54`), not a `Replicated*MergeTree`. ClickHouse honors `insert_deduplication_token` only for `Replicated*MergeTree` (synchronous inserts) or on the async path with `async_insert_deduplicate=1`. On a plain `MergeTree` the token is a no-op. Presenting it as the enforcement mechanism is a false guarantee: if a retry re-drives the block, the token does not prevent a second physical copy.

The real, working idempotency was already implemented and does not depend on the token:
- `GroupMemberEventBuilder._deriveEventId` derives `event_id` as `uuidv5(group_id | entity_reference | event_type | correlation_id)`, and `event_time` is deterministic (sourced from `meta.lastUpdated`). A retry of the same logical write produces byte-identical rows.
- The `AggregatingMergeTree` current-state tables resolve state with `argMax` over `(event_time, event_id)`. Two identical physical rows collapse to one logical member state on read regardless of how many copies were inserted.

## Decision

### Decision 1 — Fail-closed, admin-exempt tenant filtering, matching SecurityTagManager

The ClickHouse read path derives an authoritative `hasFullAccess` signal from the caller's **scope** (not from tag presence) and threads it into the query builder:

- The two search entry points (`searchBundle`, `searchStreaming`) add the parsed `scope`/`user` to `extraInfo`.
- `MongoWithClickHouseStorageProvider` receives an injected `ScopesManager` (via `StorageProviderFactory`) and computes `hasFullAccess` in `_callerHasFullAccess(extraInfo)` as `getAccessCodesFromScopes('read', user, scope).includes('*')` — the same wildcard contract `SecurityTagManager` uses.
- `hasFullAccess` is passed to `QueryBuilder.buildFindGroupsByMemberQuery` / `buildCountGroupsByMemberQuery`, and `_buildActiveMemberHavingClause` applies:
  - **Full/wildcard access** → apply **no** tenant predicate (the admin legitimately sees all).
  - **Scoped** (non-empty access/owner tags) → apply the existing `hasAny(argMaxMerge(access_tags/owner_tags), ...)` filter.
  - **Genuinely unscoped non-admin** (no tags and not full access) → throw `ForbiddenError` (403). This mirrors the write path (which throws on empty tags) and `SecurityTagManager`. Such callers are already 403'd upstream, so this branch is defense-in-depth.

Throwing (rather than the previous silent `1 = 0`) is safe end-to-end: `ForbiddenError` carries `statusCode` 403, and `RethrownError` preserves a numeric `statusCode` and the `issue` array, so the find path (which wraps errors) still surfaces a 403 `OperationOutcome` rather than a 500 or a leak. Preferring a 403 over a silent empty result makes the denial observable instead of masquerading as "no matching groups."

### Decision 2 — Content/version-derived idempotency; drop the inert dedup token

`GroupMemberRepository.appendEvents` no longer sets `insert_deduplicate` / `insert_deduplication_token`. Idempotency rests entirely on the deterministic rows (`event_id` = uuidv5 of content/version + deterministic `event_time`) and `argMax` convergence on the `AggregatingMergeTree` current-state tables. The retry (bounded, jittered backoff) is unchanged and remains safe because a re-driven block is byte-identical. Code comments now describe the deterministic-row + `argMax` mechanism as the enforcement and explicitly note the token is inert on a plain `MergeTree`.

The idempotency key remains the content/version-derived `event_id`, **not** an OpenTelemetry or request id. A per-request id would change on a client retry and defeat convergence; the content/version key is stable across retries, which is the property idempotency requires.

## Consequences

### Positive

1. Legitimate wildcard admins can perform Group member reverse-lookups again (the regression is fixed) without weakening tenant isolation for scoped callers.
2. Authorization is derived from the authoritative source (parsed scope via `ScopesManager`), not inferred from whether a query happened to carry tag predicates.
3. A genuinely unscoped caller reaching the builder gets a clear 403 `OperationOutcome`, consistent with the write path and the rest of the platform, instead of a silent empty set.
4. Idempotency documentation now matches reality; nobody will later "rely on" a no-op token. Correctness rests on the deterministic rows, which already existed and are engine-independent.
5. Smaller, honest surface: the insert carries only the settings that actually do something (`async_insert`, `wait_for_async_insert`).

### Negative

1. `MongoWithClickHouseStorageProvider` now depends on `ScopesManager`, a light coupling of a storage provider to a security service. Accepted because this provider already makes the tenant-filtering decision and needs an authoritative scope interpreter; injecting one shared interpreter is cleaner than duplicating scope parsing.
2. `scope`/`user` now flow through `extraInfo` on the search path. This is inert for the MongoDB providers (they ignore it) and only consumed by the ClickHouse provider.
3. If the events table is ever migrated to `Replicated*MergeTree`, engine-level dedup becomes available; a future change could add it as a second layer, but the deterministic-row mechanism remains the primary guarantee.

### Mitigations

- The `ScopesManager` dependency is optional in the provider/factory constructors (`scopesManager || null`); when absent, `_callerHasFullAccess` returns `false`, preserving fail-closed behavior.
- Unit tests cover: full-access caller not denied (predicate omitted), scoped caller filtered, unscoped non-admin denied with 403, the provider's scope-derived signal, and that the insert does not set the inert dedup settings while retried blocks remain byte-identical.

## Options Considered

### Decision 1 options

**Option 1A — Keep `1 = 0` on empty tags (rejected, the prior design).** Force-denies legitimate wildcard admins and infers authorization from tag absence. Rejected: it is a correctness regression and conflates "no tenant predicate needed" with "no access."

**Option 1B — Compute `hasFullAccess` upstream in the search entry points and thread the boolean down (rejected).** `searchBundle`/`searchStreaming` do not hold a `ScopesManager`, so this required injecting one into both plus threading a new field through `getCursorForQueryAsync` and the mongo path — a wide change to the hot MongoDB search path for a ClickHouse-only concern. Rejected in favor of deriving the signal where it is used.

**Option 1C — Inject `ScopesManager` into the ClickHouse provider and derive `hasFullAccess` there from scope (selected).** One shared authoritative interpreter, minimal blast radius (two `extraInfo` sites, the factory, the provider, the builder), and no behavior change to the MongoDB path.

### Decision 2 options

**Option 2A — Keep `insert_deduplication_token` (rejected).** Inert on a plain `MergeTree`; presents a false guarantee. Rejected.

**Option 2B — Switch the idempotency key to an OTel/request id (rejected).** Per-request ids change on retry and defeat `argMax` convergence. Rejected: idempotency requires a key stable across retries.

**Option 2C — Migrate the table to `Replicated*MergeTree` to make the token work (out of scope).** A larger infrastructure change than the defect warrants; the deterministic-row mechanism already provides idempotency on the current engine. Can be revisited if replication is adopted for other reasons.

**Option 2D — Drop the inert token; rely on deterministic rows + `argMax` (selected).** Removes the false guarantee, keeps the real (engine-independent) mechanism, and corrects the comments.

## References

- `src/operations/common/securityTagManager.js:55-73` — wildcard admin → empty tags; no access → 403.
- `src/operations/security/scopesManager.js:49-77,140-143` — scope → access codes, `*` = full access.
- `src/operations/search/searchManager.js:280` — security predicate only added when tags are non-empty.
- `src/utils/clickHouse/queryFragments.js:208-260` — write path throws on empty tags (the convention this read path now matches).
- `clickhouse-init/01-init-schema.sql:53-54` — events table is a plain (non-Replicated) `MergeTree`.
- `src/dataLayer/builders/groupMemberEventBuilder.js` — deterministic `event_id` (uuidv5) and `event_time`.
- ClickHouse docs: `insert_deduplication_token` is honored by `Replicated*MergeTree` (sync) or async inserts with `async_insert_deduplicate=1`; it is a no-op on a plain `MergeTree`.
- CLAUDE.md / AGENTS.md (icanbwell): tenant isolation is mandatory on every query path; idempotency by default for retry-capable operations.

## Related Decisions

- ADR 0001 (schema registry pattern for ClickHouse-only resources) and ADR 0002 (observability emission pattern) are adjacent ClickHouse/observability decisions in this repo.
- EA-2323 (Jira): the Group ClickHouse hardening this ADR revises.

---

**Date**: 2026-07-01
**Authors**: Bill Field
**Status**: Accepted
