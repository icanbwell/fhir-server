# Causal Ordering for ClickHouse Group Membership Current-State

## Status

Accepted (EA-2326; follows and builds on [ADR 0003](0003-clickhouse-group-tenant-isolation-and-idempotency.md))

**Scope notes:**
- This ADR covers how the derived current-state of a Group member is ordered when multiple add/remove events share a timestamp. It changes the ClickHouse schema (`clickhouse-init/01-init-schema.sql`) and the read-path tie-break tuple; it does not change the FHIR contract or the MongoDB paths.
- It preserves the idempotency guarantee established in ADR 0003: a retried write still converges to one logical member state.

## Context

Group membership is an append-only event log (`fhir.Group_4_0_0_MemberEvents`), with current state derived per member as:

```
argMax(event_type, tie)   -- "the event_type of the row with the largest tie tuple wins"
```

ADR 0003 / EA-2323 made the event rows deterministic so retries converge: `event_id` is a `uuidv5` of `(group_id | entity_reference | event_type | correlation_id)`, and `event_time` is sourced from the resource's `meta.lastUpdated`. A retried write therefore produces byte-identical rows and `argMax` collapses them to one logical state.

The tie tuple was `(event_time, event_id)`.

### The bug (BUG-4)

When an add and a later remove for the same member carry the **same `event_time`**, the tie is broken by `event_id` — a **content hash, not causal order**. The causally-later remove can lose the tie, so the member wrongly reads back as still active.

This was reproduced end-to-end (a create-then-`PUT member:[]` read back a non-zero active count via the GET API) and as a pure unit expression. Making `event_time` deterministic (EA-2323) makes equal-timestamp ties *more* frequent (a fast create-then-update echoes the same `meta.lastUpdated` millisecond), so the idempotency fix and correct causal ordering are in direct tension: both need a stable tuple, but the stable tuple must also encode causal order.

## Decision Drivers

- **Causal correctness:** a later operation must win over an earlier one for the same member.
- **Idempotency (keep ADR 0003):** a retry of the same logical write must converge to the same state (identical rows).
- **No write-time coordination:** preserve the append-only, high-volume (`async_insert`) model; no per-write global counters or locks across pods.
- **Reuse platform invariants:** FHIR `meta.versionId` is server-assigned and increments per resource version.

## Options Considered

**Option 1 — Per-group monotonic sequence assigned at write time.** Strictly causal, but requires write-time coordination (a counter/lock) across 700-1000 pods, reintroducing exactly the coordination the event log avoids, and a retry must reuse the same sequence or idempotency breaks. **Rejected** (coordination + idempotency cost).

**Option 2 — Server-clock `event_time` per event.** Stamp `event_time` from a server clock at write time instead of `meta.lastUpdated`. Simple, but a retry gets a *new* timestamp, so rows differ and **ADR 0003 idempotency breaks**; clock skew across pods still allows ties. **Rejected** (breaks idempotency).

**Option 3 (chosen) — `meta.versionId` as the primary causal tie-breaker, plus a per-write `batch_seq`, keeping the deterministic `event_id` beneath for idempotency.** Order current-state by `argMax(event_type, (version_id, batch_seq, event_time, event_id))`. `versionId` is server-assigned and increments on every write, so a later operation carries a higher `version_id` and deterministically wins. A retry of the same committed version reuses the same `version_id`, the same `batch_seq`, and the same `event_id`, so it still converges. Aligns causal order with FHIR's own version monotonicity; no write-time coordination.

## Decision

Adopt **Option 3**. Thread the resource `meta.versionId` (as `version_id`, an integer) and a per-write monotonic index (`batch_seq`) into each member event, and make the current-state tie-break tuple `(version_id, batch_seq, event_time, event_id)`:

- **`version_id`** leads. A causally-later write (higher resource version) wins for the same member even when `event_time` ties. This fixes BUG-4.
- **`batch_seq`** disambiguates events *within a single write* (same `version_id`), where `event_time` is identical by construction. It is assigned in the event builder as the event's index within the write; a combined add+remove batch uses an offset so additions and removals never share an index.
- **`event_time`, `event_id`** remain beneath as stable, deterministic fallbacks. `event_id` (the content hash) keeps retried rows byte-identical, so idempotency is preserved.

The same tuple is applied in both places that resolve current state, so direct-events reads and materialized-view reads agree:
- The `AggregatingMergeTree` current-state tables (`Group_4_0_0_MemberCurrent`, `Group_4_0_0_MemberCurrentByEntity`) store `argMax` states typed by the new tuple, and their MVs aggregate with `tuple(version_id, batch_seq, event_time, event_id)`.
- The direct-events read fragment (`QueryFragments.argMaxWithTieBreaker`) defaults to the same tuple.

## Consequences

- **Fixes BUG-4:** cross-version add/remove ordering is now causal (higher version wins), verified by the previously-skipped EA-2326 repro tests, now enabled and green.
- **Idempotency retained (ADR 0003):** a same-version retry re-derives the same `version_id`, `batch_seq`, and `event_id`, so rows stay identical and `argMax` converges.
- **Schema migration required.** `version_id UInt64` and `batch_seq UInt32` are added to the event log, and the current-state tables + MVs are rebuilt with the new `argMax` tuple type (an `AggregateFunction` type change cannot be `ALTER`ed in place). Fresh installs get the correct schema from `clickhouse-init/01-init-schema.sql`; existing clusters run `clickhouse-migrations/07-group-member-causal-ordering.sql`, which adds the columns, rebuilds the derived tables/MVs, and backfills them from the event log (the source of truth). This is a coordinated DDL change, sequenced with the schema-apply automation (EA-2318) and the dev CREATE grant (CIE-8223). Groups-on-ClickHouse is dev-only today, so no production data is affected.
- **Pre-migration events** get `version_id = 0` / `batch_seq = 0` via column `DEFAULT`s. This only affects ordering *among* pre-migration events (which already resolved by `event_time`/`event_id`); it does not affect post-migration correctness.
- **Residual edge — intra-write reorder of the same member.** If a single write (one `version_id`) both removes and re-adds the *same* member (e.g. one PATCH carrying both ops), the two events share `version_id` and `event_time` and are ordered by `batch_seq`. `batch_seq` is assigned in the order the builder emits events (additions before removals in the combined batch), which is deterministic and idempotent but is not the PATCH's internal operation order. Threading true operation order from the PATCH layer is out of scope here; this edge is rare and does not affect the cross-write case that BUG-4 covers.

## References

- EA-2326 (this change), EA-2323 / ADR 0003 (idempotency this builds on), EA-2318 (schema-apply automation), CIE-8223 (dev ClickHouse DDL grant)
- Schema: `clickhouse-init/01-init-schema.sql`, migration `clickhouse-migrations/07-group-member-causal-ordering.sql`
- Code: `src/dataLayer/builders/groupMemberEventBuilder.js`, `src/utils/clickHouse/queryFragments.js`
- Tests: `src/tests/group/group_update_operations.test.js` (integration repro), `src/tests/group/group_clickhouse_adversarial.unit.test.js` (unit contracts)
