# Causal Ordering for ClickHouse Group Membership Current-State

## Status

Accepted (follows and builds on [ADR 0003](0003-clickhouse-group-tenant-isolation-and-idempotency.md))

**Scope notes:**
- This ADR covers how the derived current-state of a Group member is ordered when multiple add/remove events share a timestamp, and the FHIR-compliance fix that makes that ordering work for hybrid-storage Groups. It changes the ClickHouse schema (`clickhouse-init/01-init-schema.sql`), the read-path tie-break tuple, and the Group update path (so a membership change advances `meta.versionId`). It does not change the FHIR contract or the MongoDB storage shape (the Mongo document stays metadata-only).
- It preserves the idempotency guarantee established in ADR 0003: a retried write still converges to one logical member state.

## Context

Group membership is an append-only event log (`fhir.Group_4_0_0_MemberEvents`), with current state derived per member as:

```
argMax(event_type, tie)   -- "the event_type of the row with the largest tie tuple wins"
```

ADR 0003 made the event rows deterministic so retries converge: `event_id` is a `uuidv5` of `(group_id | entity_reference | event_type | correlation_id)`, and `event_time` is sourced from the resource's `meta.lastUpdated`. A retried write therefore produces byte-identical rows and `argMax` collapses them to one logical state.

The tie tuple was `(event_time, event_id)`.

### The problem

When an add and a later remove for the same member carry the **same `event_time`**, the tie is broken by `event_id` — a **content hash, not causal order**. The causally-later remove can lose the tie, so the member wrongly reads back as still active.

This was reproduced end-to-end: a create with N members followed by a `PUT member:[]` read back a non-zero active count via the GET API. Two forces combine to cause it:

1. **Equal timestamps are common by construction.** Making `event_time` deterministic (ADR 0003) means a fast create-then-update echoes the same `meta.lastUpdated` millisecond, so `event_time` cannot separate the add from the remove.
2. **The frozen-version bug (the root cause).** For a hybrid-storage Group the `member[]` array is stripped from the Mongo document, so a member-only `PUT` does not change any Mongo metadata. The generic content diff (in `ResourceMerger.mergeResourceAsync`, a `smartMerge:false` full replace for `PUT`) therefore saw no change and `updateMeta` did **not** bump `meta.versionId` or `meta.lastUpdated`. A create's add events and a later member-only `PUT`'s remove events both carried `version_id = 1` and an identical `event_time`, so nothing could order them.

Per the FHIR R4 specification, `meta.versionId` and `meta.lastUpdated` MUST change each time the **content** of a resource changes, and `Group.member` is resource content. The frozen-version behavior is therefore itself a FHIR-compliance bug — and fixing it is exactly what makes the causal ordering resolvable.

## Decision Drivers

- **FHIR compliance:** a change to `Group.member` must advance `meta.versionId` / `meta.lastUpdated`, the same as it does for a pure-Mongo Group.
- **Causal correctness:** a later operation must win over an earlier one for the same member.
- **Idempotency (keep ADR 0003):** a retry of the same logical write must converge to the same state (identical rows).
- **No write-time coordination:** preserve the append-only, high-volume (`async_insert`) model; no per-write global counters or locks across pods.
- **Opaque and scoped:** the fix must not affect non-ClickHouse resources or the ClickHouse-off path, and must not change how a pure-Mongo Group behaves.
- **Reuse platform invariants:** FHIR `meta.versionId` is server-assigned and increments per resource version.

## Options Considered

### Making the version advance on a hybrid-Group membership change

**Option A — special-case the version bump.** Detect a hybrid-Group member-only write in the update path and manually increment `meta.versionId`. Rejected: it duplicates and diverges from the generic version machinery (two code paths that can drift), and it is a bespoke rule rather than reusing the existing content-diff → `updateMeta` flow.

**Option B (chosen) — hydrate the current members before the merge.** For a hybrid Group, load the current roster from ClickHouse onto the found (stored) resource *before* `mergeResourceAsync` runs. The generic content diff then sees the real before/after member arrays, detects the membership change, and `updateMeta` bumps `version_id` + `lastUpdated` naturally — exactly as it already does for a pure-Mongo Group. The hydrated member array is re-stripped downstream (`handleClickHouseGroupPreSave` in the bulk inserter), so the Mongo document stays metadata-only. This is opaque (no new versioning rule; the existing machinery does the work) and reuses one code path. `POST` (create) is version 1; `PATCH` already bumps (its strategy passes `incrementVersion:true`).

### Ordering equal-timestamp events

**Option 1 — per-group monotonic sequence assigned at write time.** Strictly causal, but requires write-time coordination (a counter/lock) across many pods, reintroducing exactly the coordination the event log avoids, and a retry must reuse the same sequence or idempotency breaks. **Rejected** (coordination + idempotency cost).

**Option 2 — server-clock `event_time` per event.** Stamp `event_time` from a server clock at write time instead of `meta.lastUpdated`. Simple, but a retry gets a *new* timestamp, so rows differ and **ADR 0003 idempotency breaks**; clock skew across pods still allows ties. **Rejected** (breaks idempotency).

**Option 3 (chosen) — `meta.versionId` as the primary causal tie-breaker, plus a per-write `batch_seq`, keeping the deterministic `event_id` beneath for idempotency.** Order current-state by `argMax(event_type, (version_id, batch_seq, event_time, event_id))`. `versionId` is server-assigned and increments on every write, so a later operation carries a higher `version_id` and deterministically wins. A retry of the same committed version reuses the same `version_id`, the same `batch_seq`, and the same `event_id`, so it still converges. Aligns causal order with FHIR's own version monotonicity; no write-time coordination.

## Decision

Adopt **Option B + Option 3** together — they are two halves of one fix:

1. **Advance the version on a membership change (Option B).** In the Group update path (`src/operations/update/update.js`), before the merge, hydrate `currentResource.member` from ClickHouse (`GroupMemberRepository.getActiveMembers`, reconstructing minimal `{ entity: { reference } }` entries) when — and only when — the resource is a hybrid Group: `configManager.enableClickHouse` **and** `configManager.mongoWithClickHouseResources.includes('Group')` **and** the stored document carries the external-storage member tag (`system: https://www.icanbwell.com/externalStorageFields`, `code: member`) **and** the repository is wired. Everything about the hook no-ops when ClickHouse is off or the resource is not a hybrid Group. The repository is injected through the DI container (`src/createContainer.js`) and returns `null` when ClickHouse is disabled.

2. **Order equal-timestamp events causally (Option 3).** Thread the resource `meta.versionId` (as `version_id`, an integer) and a per-write monotonic index (`batch_seq`) into each member event, and make the current-state tie-break tuple `(version_id, batch_seq, event_time, event_id)`:
   - **`version_id`** leads. A causally-later write (higher resource version) wins for the same member even when `event_time` ties. Because the hydrate-before-merge step now advances the version on a membership change, a create's adds (v1) and a later member-only `PUT`'s removes (v2) carry different `version_id`s and order correctly.
   - **`batch_seq`** disambiguates events *within a single write* (same `version_id`), where `event_time` is identical by construction. It is assigned in the event builder as the event's index within the write; a combined add+remove batch uses an offset so additions and removals never share an index.
   - **`event_time`, `event_id`** remain beneath as stable, deterministic fallbacks. `event_id` (the content hash) keeps retried rows byte-identical, so idempotency is preserved.

The same tuple is applied in both places that resolve current state, so direct-events reads and materialized-view reads agree:
- The `AggregatingMergeTree` current-state tables (`Group_4_0_0_MemberCurrent`, `Group_4_0_0_MemberCurrentByEntity`) store `argMax` states typed by the new tuple, and their MVs aggregate with `tuple(version_id, batch_seq, event_time, event_id)`.
- The direct-events read fragment (`QueryFragments.argMaxWithTieBreaker`) defaults to the same tuple.

## Consequences

- **FHIR compliance restored, opaquely.** A `Group.member` change now advances `meta.versionId` / `meta.lastUpdated` for hybrid Groups exactly as for pure-Mongo Groups, via the existing content-diff machinery. No new versioning rule was introduced.
- **Cross-version add/remove ordering is now causal** (higher version wins), verified by the previously-failing repro (a create-then-`PUT member:[]` now reads back 0 active) and pure-unit contracts.
- **Idempotency retained (ADR 0003):** a same-version retry re-derives the same `version_id`, `batch_seq`, and `event_id`, so rows stay identical and `argMax` converges.
- **Scoped blast radius.** The hydration hook is gated on ClickHouse being enabled, the resource being a hybrid Group, and the external-storage member tag being present; it no-ops otherwise. Non-ClickHouse resources and the ClickHouse-off path are untouched.
- **One extra ClickHouse read on a hybrid-Group `PUT`.** The hook issues a single `getActiveMembers` roster read before the merge. It is skipped entirely for metadata-only pure-Mongo Groups and for all non-Group resources.
- **Schema migration required.** `version_id UInt64` and `batch_seq UInt32` are added to the event log, and the current-state tables + MVs are rebuilt with the new `argMax` tuple type (an `AggregateFunction` type change cannot be `ALTER`ed in place). Fresh installs get the correct schema from `clickhouse-init/01-init-schema.sql`; existing clusters run `clickhouse-migrations/07-group-member-causal-ordering.sql`, which adds the columns, rebuilds the derived tables/MVs, and backfills them from the event log (the source of truth). This is a coordinated DDL change sequenced with the schema-apply automation. Groups-on-ClickHouse is dev-only today, so no production data is affected.
- **Pre-migration events** get `version_id = 0` / `batch_seq = 0` via column `DEFAULT`s. This only affects ordering *among* pre-migration events (which already resolved by `event_time`/`event_id`); it does not affect post-migration correctness.
- **Residual edge — intra-write reorder of the same member.** If a single write (one `version_id`) both removes and re-adds the *same* member (e.g. one PATCH carrying both ops), the two events share `version_id` and `event_time` and are ordered by `batch_seq`. `batch_seq` is assigned in the order the builder emits events (additions before removals in the combined batch), which is deterministic and idempotent but is not the PATCH's internal operation order. Threading true operation order from the PATCH layer is out of scope here; this edge is rare and does not affect the cross-write case this change targets.

## References

- ADR 0003 (idempotency this builds on)
- Schema: `clickhouse-init/01-init-schema.sql`, migration `clickhouse-migrations/07-group-member-causal-ordering.sql`
- Code: `src/operations/update/update.js` (hydrate-before-merge version bump), `src/dataLayer/repositories/groupMemberRepository.js` (`getActiveMembers`), `src/utils/clickHouseGroupPreSave.js` (external-storage tag + member strip), `src/dataLayer/builders/groupMemberEventBuilder.js`, `src/utils/clickHouse/queryFragments.js`
- Tests: `src/tests/group/group_update_operations.test.js` (integration repro), `src/tests/group/group_version_bump.unit.test.js` (version-bump hook), `src/tests/group/group_clickhouse_adversarial.unit.test.js` (unit contracts)
