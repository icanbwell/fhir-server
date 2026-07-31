# Group Identity in the ClickHouse Membership Tables

## Status

Accepted

**Scope notes:**
- This ADR settles what identifies "one Group" in the ClickHouse membership path (`fhir.Group_4_0_0_MemberEvents` and the two derived current-state tables). It adds a `group_uuid` column, makes it the leading key of both derived tables and the event log, and makes it the sole predicate of every query that narrows to one Group.
- It does not change the FHIR contract or the MongoDB read/write paths.
- It is orthogonal to ADR 0003, which governs *authorization* on the reverse-lookup read (`GET /Group?member=...`) via security tags. This ADR governs *identity*. The two are independent: a correct tag filter does not fix a key that merges tenants, and a correct key does not authorize a caller.

The key swap landed before Groups-on-ClickHouse was released, so no client-visible data was ever keyed on the logical id.

## Context

Membership is event-sourced: `fhir.Group_4_0_0_MemberEvents` is an append-only log, and current state is derived by `AggregatingMergeTree` materialized views that resolve one logical row per member via `argMax` over the tie tuple from ADR 0004.

Every per-Group query narrowed on `group_id` alone, and `group_id` is populated from `doc.id` — the FHIR **logical** id.

The logical id is not identity, for two independent reasons.

**It is not tenant-unique.** `POST /Group` assigns a server-generated UUID (`create.js`), which cannot collide, but FHIR update-as-create lets a client choose the id outright: `PUT /Group/my-cohort` creates a Group with that id and returns 201. Two tenants can each do that with the same string, and both writes are legitimate — MongoDB distinguishes the documents by `_uuid = uuidv5(id|sourceAssigningAuthority)` (`UuidColumnHandler`), so it stores two separate Groups.

ClickHouse merged them. Three consequences were reproduced against a real ClickHouse container with two tenants sharing one logical id:

1. **`Group.quantity` returned the union of both rosters.** Rosters of 3 and 1 both read back as 4 — simultaneously a cross-tenant disclosure and a number that is wrong for either tenant.
2. **Current-state rows physically collapsed.** On an `AggregatingMergeTree` the sorting key *is* the aggregation key, so with `ORDER BY (group_id, entity_reference)` the same member reference in two tenants became one row, and one tenant's state overwrote the other's. This is the part a query-level predicate cannot repair: the distinguishing data is already gone by read time.
3. **A write by one tenant destroyed another tenant's membership.** The update path hydrates the current roster and diffs the incoming roster against it. Hydrating by logical id returned the other tenant's members too, so they appeared absent from the incoming roster and were emitted as `removed` events.

**It is mutated on the read path before the membership query runs.** `EnrichmentManager.enrichAsync` runs providers sequentially in registration order (`src/enrich/enrich.js`), and `src/createContainer.js` registers:

| Order | Provider | Effect on `resource.id` |
|---|---|---|
| `:182` | `IdEnrichmentProvider` | `resource.id = resource._sourceId` |
| `:184` | `GlobalIdEnrichmentProvider` | under `Prefer: global_id=true` → `resource.id = resource._uuid` |
| `:191` | `GroupMemberEnrichmentProvider` | read `resource.id` → ClickHouse `group_id` predicate |

So on `GET /Group/x` with `Prefer: global_id=true`, the count queried `group_id = <uuid>` while the event rows held the logical id: **`quantity: 0` on a Group that has members.** That is a wrong answer returned with a 200, the exact failure mode the provider's own rethrow-rather-than-mask-as-0 handling exists to prevent — and it is not a tenant issue at all. Any key derived from `resource.id` is reading a presentation field.

The exposure was never client-reachable: Groups-on-ClickHouse is not enabled for production traffic, and this service is the only writer.

### The abstract problem

Stripped of the FHIR specifics, keying on `group_id` is *identity reconstruction from a lossy projection*: `resource.id` is a presentation-time projection of the stored entity, and the membership path was trying to recover which stored entity a row belonged to from it. Reconstruction is the anti-pattern; the reduction is not a cleverer reconstruction but **carry the stable key** (`substrate/decision-guides/abstraction-and-reduction.md#dg-abstraction-reduction`).

The repo had already made that reduction everywhere else. `_uuid` is the key of the MongoDB documents (`uuidColumnHandler.js`), of the AuditEvent ClickHouse table (`clickhouse-init/02-audit-event.sql:8,54`), and of the Group compensation path, which matches `{ _uuid: uuid }` (`clickHouseGroupPreSave.js:146`). Group membership was the only store in the repo keyed on a presentation field.

### Why the existing tests could not have caught it

The paths were covered — the Group suite was fully green — and both gaps were missing **fixture dimensions**, not missing assertions.

`groupTestSetup.js` had exactly one header helper, carrying a wildcard scope and a single owner/access tag pair. With one tenant, `group_id` *is* unique, so `WHERE group_id = X` is correct in every existing test and the tenant defect is invisible by construction. It also required a second condition: a client-chosen id, which only `PUT` produces, while most tests use `POST`.

The enrichment-mutation defect had the same shape: `grep -rln global_id src/tests/group/` returned nothing, so no Group test exercised the header that triggers the rewrite.

## Decision Drivers

1. Identity must hold structurally, not by remembering to add a predicate or read the right field at each call site.
2. The fix must close the write path (roster hydration and diff), not only the read path.
3. Identity must survive the boundary hand-offs: the reverse lookup passes ClickHouse's result to MongoDB as a single `$in` list.
4. Prefer one existing key over a second, parallel identity scheme for the same entity.
5. The event log is append-only; a fix that rewrites released client data would be disproportionate. (Not binding here — nothing is released.)

## Options Considered

**Option A — Add a tenant predicate to the read queries only (rejected).** Insufficient, and the reason is engine-level: consequence 2 above already collapsed the rows before any read. A predicate over merged rows filters nothing back into existence. It also leaves the write path destroying data, and does nothing about the enrichment mutation.

**Option B — Re-key on the `_uuid` the resource already carries (selected).** See the Decision below.

**Option C — Treat `(group_id, group_source_assigning_authority)` as Group identity (rejected).** The case for it: the pair is *equivalent* to `_uuid` (since `_uuid` is derived from exactly those two values), and the authority is already present on every event row, so no backfill is needed. Both statements are true, and the option still fails on two counts:

1. **A two-column key degrades to one column at every boundary that passes a list of ids.** The reverse lookup resolves candidate Groups in ClickHouse and hands them to MongoDB as `{ $in: [...] }` (`queryExecutor.js`, `mongoWithClickHouseStorageProvider._countGroupsByMemberWithResidual`). A single `$in` list can carry one value per row. Keyed on the pair, the only thing that fits is the logical id — which is not unique in MongoDB either, so the hand-off can return **another tenant's Group document**. `_uuid` fixes this by construction; the pair cannot.
2. **It is a second identity scheme for an entity that already has one.** MongoDB, the AuditEvent table, and the Group compensation path all key on `_uuid`. Introducing a parallel composite key for the same entity reinvents settled prior art (`substrate/rubrics/tech-design-rubric.md` TD15) and leaves two definitions of "the same Group" to keep in agreement.

A third, softer count: the pair has a nullable half, which is what made an "incomplete identity" state expressible and produced a policy question about what to do in it. `_uuid` is a single non-null value on every committed Group, so the question does not arise.

**Option C's rejection of Option B was also factually wrong** and is corrected here. It claimed Option B needs "`generateUUIDv5` — which is not available in the ClickHouse version in use (26.2)." No ClickHouse-side UUID computation is required: `_uuid` is computed by `UuidColumnHandler` in Node **before** the write, and `afterSaveAsync` receives the post-pre-save resource (`mongoBulkWriteExecutor.js:597`), so the write simply *carries* `doc._uuid` into a column. ClickHouse's lack of `generateUUIDv5` constrains a SQL-side **backfill**, not the design.

**Option D — Reject client-chosen ids for Group (rejected).** Update-as-create is a required FHIR R4 capability and is used deliberately; refusing it to protect a storage key inverts the dependency. It also would not fix the enrichment mutation.

## Decision

**`group_uuid` — carrying MongoDB's `_uuid = uuidv5(id|sourceAssigningAuthority)` — is the identity of a Group in the ClickHouse membership path.** It is a single value, bound as a query parameter, on every query that narrows to one Group.

`group_id` and `group_source_assigning_authority` remain on the rows as **provenance**: still wanted for debugging and for reading the tables directly. They are not identity, and no query narrows to one Group with them.

**Schema (`clickhouse-init/01-init-schema.sql`, migration `08-group-member-uuid-key.sql`).** `group_uuid String` leads the event log's `ORDER BY` and both current-state tables' `ORDER BY` and their MVs' `GROUP BY`. In the derived tables `group_id` and `group_source_assigning_authority` became `AggregateFunction(argMax, ...)` columns, since they now describe the latest state of a row rather than identifying it. Because a key column cannot be `ALTER`ed into a sorting key in place, migration 08 drops and recreates all three tables.

**Migration 08 discards existing rows rather than backfilling them, and this is destructive.** For Groups written with `useExternalStorage`, `stripMembersIfNeeded` does `delete doc.member` (`clickHouseGroupPreSave.js:75-79`), so **ClickHouse is the only copy of the roster** — Mongo holds metadata only. Discarding the event log therefore permanently discards those rosters: the Group documents survive and read back `quantity: 0` with no members. That is acceptable *here* — dev/staging only, nothing released, re-seedable — but it is data loss, not a no-op, so the migration prints the affected Group count, refuses to run without an explicit single-use sentinel table, and states in its header that it must never be run against a cluster serving traffic.

**The known alternative, if a cluster ever does need this without data loss:** compute `generateUUIDv5(\`${group_id}|${gsaa}\`)` in Node (where it is available), `ALTER TABLE ... UPDATE` the new column, verify zero rows with `group_uuid = ''`, then rebuild the derived tables. Recorded here so it is a known option rather than a discovery under pressure.

**Write path.** `GroupMemberEventBuilder._extractGroupUuid` reads `groupResource._uuid` and throws if it is absent. This is a genuine, reachable invariant about pre-save ordering: `UuidColumnHandler` must have run before event building. The Group's `_uuid` also became the first term of the deterministic `event_id` hash, replacing the logical id there.

**Read path.** `QueryFragments.whereGroupId` became `whereGroupUuid`, emitting one predicate and still throwing on its non-parameterized branch. `QueryBuilder.buildActiveMembers` / `buildActiveMemberCount`, `GroupMemberRepository.getActiveMembers`, `GroupMemberEnrichmentProvider._getMemberCount`, `MongoWithClickHouseStorageProvider.getActiveMemberCountAsync` / `getCurrentMembersWithCountAsync`, `ClickHouseGroupHandler._getCurrentMembers`, and `UpdateOperation._hydrateHybridGroupMembersBeforeMerge` each take a single `groupUuid`, read from the resource's `_uuid`.

**Reverse lookup.** The ClickHouse page selects, orders, and seeks on `group_uuid`, and MongoDB is handed `{ _uuid: { $in: [...] } }` rather than `{ id: { $in: [...] } }`. This also repaired a latent mismatch: the next-link cursor was already a `_uuid` value (`configManager.defaultSortId` → `bundleManager` `id:above` → `fieldMapper` → `_uuid`), and `QueryParser.extractPaginationCursor` was feeding it to ClickHouse to compare against `group_id`.

**The guard is a single `assertIsValid(groupUuid)`.** `_uuid` is non-null on every committed Group, so there is no partial-identity state and no policy to write for one: either the caller has it or the call is a programming error. A guard that throws only *conditionally* — on identifiers that fail a UUID shape test, say — would be worse than none here: a UUID-shaped value skips the throw, so the enrichment-mutation case fails *silently* with `quantity: 0` instead of loudly.

**Incomplete identity is not reachable, so it is not the isolation mechanism.** `_sourceAssigningAuthority` is derived (sourceAssigningAuthority tag → else owner tag, `sourceAssigningAuthorityColumnHandler.js`; owner ← access tag, `ownerColumnHandler.js`) and the write path independently throws without an owner tag (`groupMemberEventBuilder.js`, "Must have at least one owner tag"). A stored Group with member events and no authority cannot exist. Any guard on that state is defense-in-depth on an unreachable branch; the key is what provides isolation.

**Multi-tenant fixtures.** `groupTestSetup.js` exports `getScopedHeaders(tenant)`, so a second tenant is a default-available fixture dimension rather than something each test reinvents.

## Consequences

### Positive

1. Identity is a property of a field that nothing mutates. The `Prefer: global_id=true` failure is structurally impossible rather than guarded against — `_uuid` is not rewritten or stripped on the read path, and `MetaUuidEnrichmentProvider` reads it un-mutated one slot before the Group provider.
2. Tenant isolation is a property of the key: a query cannot express an id-only filter, and `whereGroupUuid` has no interpolated form.
3. The write path is fixed: roster hydration and the add/remove diff are scoped to one Group, so one tenant's write can no longer emit removals against another's members.
4. The reverse lookup's MongoDB hand-off carries a globally unique key, closing the cross-tenant document leak that no two-column key could have closed.
5. One identity scheme for the entity, matching MongoDB, the AuditEvent table, and the compensation path.
6. Two-tenant and `global_id` fixtures exist, so both defect classes are now reachable by tests.

### Negative

1. Migration 08 permanently discards existing rosters. Bounded to dev/staging by the release state, guarded by a sentinel, but real.
2. Identity must never be read from `resource.id` on any future call site. The enrichment chain (`createContainer.js:182-191`) makes that mistake easy and its symptom silent, so it is called out in the code comments at each identity read rather than left to be rediscovered.
3. The derived tables carry `group_id` twice in effect — as provenance and inside the event log — which is a small redundancy accepted for debuggability.

### Mitigations

- Groups-on-ClickHouse is not enabled for production traffic and this service is the only writer, so migration 08 affects no client-visible data.
- The derived tables are fully reconstructible from the log, so the rebuild half of the migration is repeatable if it is interrupted.
- Tests cover: per-tenant `quantity` under a shared logical id; no cross-tenant `removed` events from one tenant's update; correct `quantity` under `Prefer: global_id=true`; member search returning only the caller's Group when a logical id is shared; that the builder keys on `_uuid` even when handed a mutated logical id, and throws without it; that both query builders narrow on `group_uuid` and throw without it; and that the reverse lookup selects and pages on `group_uuid`.

## References

- `src/preSaveHandlers/handlers/uuidColumnHandler.js` — `_uuid = uuidv5(id|sourceAssigningAuthority)`, computed in Node before the write.
- `clickhouse-init/02-audit-event.sql:8,54` — prior art: the AuditEvent ClickHouse table keys on `_uuid`.
- `src/utils/clickHouseGroupPreSave.js:146` — prior art: the Group compensation path matches `{ _uuid: uuid }`.
- `src/utils/clickHouseGroupPreSave.js:75-79` — `stripMembersIfNeeded`; why ClickHouse is the sole copy of the roster and why the migration is destructive.
- `src/createContainer.js:182-191` — provider registration order; why identity must not be read from `resource.id`.
- `src/enrich/enrich.js` — providers run sequentially, so a later provider sees an earlier one's mutation.
- `src/dataLayer/bulkWriteExecutors/mongoBulkWriteExecutor.js:597` — `afterSaveAsync` receives the post-pre-save resource, so `_uuid` is present at event-build time.
- `src/operations/create/create.js:151` — `POST` assigns a server UUID; `PUT /Group/<id>` is the only path to a client-chosen id.
- `clickhouse-init/01-init-schema.sql` — `group_uuid` as the leading key of all three tables.
- `clickhouse-migrations/08-group-member-uuid-key.sql` — guarded destructive drop/recreate.
- `src/utils/clickHouse/queryFragments.js` — `whereGroupUuid`; non-parameterized form throws.
- `src/tests/group/group_quantity_tenant_isolation.test.js` — two-tenant, `global_id`, and reverse-lookup coverage.
- `substrate/decision-guides/abstraction-and-reduction.md#dg-abstraction-reduction` — the reduction applied: carry the stable key, do not reconstruct identity from a projection.
- ADR 0003 — tag-based authorization on the reverse lookup (orthogonal concern).
- ADR 0004 — the `(version_id, batch_seq, event_time, event_id)` tie tuple the rebuilt MVs use.

## Related Decisions

- ADR 0003 (tenant isolation and idempotency) and ADR 0004 (causal ordering) cover the other two correctness properties of this path. Together: 0003 decides *who may see a row*, 0006 decides *which Group a row belongs to*, 0004 decides *which of several rows wins*.

## Follow-up

- Multi-tenant and `global_id` fixtures now exist but are opt-in per test. Making them the default shape for Group tests — rather than available helpers — is broader hardening than this key fix and warrants its own ticket.
- The Mongo/ClickHouse split of one entity with no transaction between them is what makes a post-Mongo-commit ClickHouse failure unrecoverable and what makes this migration a data-loss event. An outbox addresses it without revisiting the store choice; it is tracked separately.

---

**Date**: 2026-07-30
**Authors**: Bill Field
**Status**: Accepted
