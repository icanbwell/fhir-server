# Reliable Group Membership Dual-Write (MongoDB Metadata + ClickHouse Events)

## Status

**Proposed** — EA-2329 (Tech Design Review). For review with EA, Mintu, and team. Not yet accepted.

**Scope:** the write-reliability and consistency model for Group membership on the hybrid MongoDB + ClickHouse path. It does not change the FHIR contract or the read/query shapes. It supersedes the interim compensation described in [ADR 0003](0003-clickhouse-group-tenant-isolation-and-idempotency.md) once accepted.

## Context

`Group` resources use hybrid storage: metadata lives in MongoDB, and membership lives in ClickHouse as an append-only event log with materialized current-state views. On a member-bearing write the server strips `Group.member` from the MongoDB document and records member add/remove events in ClickHouse. A single Group write is therefore a **dual-write across two stores with no shared transaction**.

Today the write path:

1. Commits the MongoDB document first (member array stripped).
2. Writes the member events to ClickHouse **synchronously** in the post-save handler (blocking the API response), so a subsequent read is consistent (read-your-writes).
3. On a ClickHouse write failure, **compensates** by restoring the stripped `member[]` back onto the just-committed MongoDB document, then re-throws so the client receives a 500.

Step 3 exists to avoid a silently-empty ("orphaned") Group when the ClickHouse write fails after the MongoDB commit.

## Problem

The compensation in step 3 is neither a transactional outbox nor a clean saga; it is a best-effort data-preservation patch on an un-coordinated dual-write, and it has real defects:

- **Split state.** After compensation the Group has members inline in MongoDB while `meta.tag` still marks membership as ClickHouse-managed, so a member-scoped read routes to the (empty) ClickHouse store and returns zero. The document has members; the read says none.
- **Does not scale.** Restoring a large member array into the MongoDB document is exactly what external storage was introduced to avoid, and it is the fallback that scales worst — it triggers precisely when ClickHouse is unavailable or the data is large.
- **Unclean failure semantics.** The operation both fails (500) and mutates MongoDB on the way out, so the failure is not atomic.

This also runs against the platform's own distributed-systems baseline (org `CLAUDE.md`): "Sagas, not distributed transactions... transactional outbox... eventually consistent, not immediately consistent." The current compensation is none of these.

## FHIR read-after-write analysis (validated against R4)

A common objection to moving membership off the synchronous path is that it would break FHIR read-after-write. Validated against the R4 specification, that objection does not hold for this case:

- **Read-after-write is a SHOULD, not a SHALL.** `http.html`: a server "SHOULD... return the same content when it is subsequently read. However systems might not be able to do this," and "a FHIR server is not obliged to accept the entire resource as it is; when the resource is retrieved through a read interaction subsequently, the resource may be different." The only hard SHALL is that `meta.versionId` / `meta.lastUpdated` are populated correctly.
- **Search is explicitly eventually consistent.** `search.html`: "The results of a search operation are only guaranteed to be current at the instant the operation is executed"; handling of concurrent updates "is at the discretion of the search engine." `_total` is an optional hint.
- **The Group read surface is metadata + a computed count.** A Group read returns the MongoDB metadata (strongly consistent) plus a server-computed `quantity` from ClickHouse; `member[]` is stripped and is not returned as stored resource content. Membership therefore surfaces only as (a) the computed `quantity` and (b) member search (`GET /Group?member=X`) — exactly the categories FHIR permits to lag.

**Conclusion:** eventual consistency of Group membership is FHIR-conformant. The strongly-consistent guarantee applies to the resource's stored representation, which stays in MongoDB and is unaffected. This removes the FHIR blocker on an asynchronous membership path, but it does not remove the operational question of whether consumers depend on synchronous visibility (see Open Questions).

## Decision Drivers

- **No lost writes.** A membership change acknowledged to the client must not be lost, including when ClickHouse is unavailable.
- **No split state.** A failure must not leave the two stores mutually inconsistent.
- **Scale.** Large / high-churn membership must not fall back to a store that cannot hold it.
- **Read-after-write in the normal case.** Preserve read-your-writes for membership when both stores are healthy (this is the current behavior and the likely consumer expectation), degrading only under failure.
- **Platform alignment.** Prefer the transactional-outbox / saga patterns the org baseline mandates over ad-hoc compensation.

## Options Considered

**Option 1 — Status quo (Mongo-first + synchronous ClickHouse + members-in-Mongo compensation).**
Preserves read-after-write; prevents outright data loss. But it is the antipattern above: split state, no scale, unclean failure. *Rejected as the target* (acceptable only as the current interim, per ADR 0003).

**Option 2 — Fail clean (remove the compensation).**
On ClickHouse write failure, return 500 and leave no split state. Residue: a transient orphaned empty Group (metadata committed, no events) that a client retry fixes and a reconciliation sweep can detect (Group carries the external-storage tag but has zero events). Honest and simple, but it still allows a committed-but-empty Group window and does not, by itself, guarantee the write eventually lands. *Reasonable interim; not sufficient as the target.*

**Option 3 — Transactional outbox with an asynchronous relay.**
Atomically commit the MongoDB metadata plus an outbox record (the intended events) in one Mongo transaction; a relay drains the outbox to ClickHouse with backoff + DLQ, idempotent via the deterministic `event_id`. Durable, no lost writes, no split state, scales. But it makes membership **always** eventually consistent, giving up read-after-write even when both stores are healthy. FHIR-conformant, but a behavior change for any consumer relying on synchronous visibility. *Rejected in favor of Option 4.*

**Option 4 (RECOMMENDED) — Synchronous-write + durable-outbox hybrid.**
Atomically commit the MongoDB metadata plus an outbox record in one Mongo transaction, then attempt the ClickHouse write synchronously in the same request. On success, membership is immediately visible (read-after-write preserved) and the outbox entry is settled. On ClickHouse failure, the write is still durable in the outbox and the relay drains it later with backoff + DLQ (idempotent by `event_id`); the operation still succeeds because the write is guaranteed to land. Degrades to eventual consistency **only while ClickHouse is unavailable** — which is exactly when strong consistency is impossible anyway. No data loss, no split state, no members-in-Mongo, and it scales. Removes the compensation entirely.

**Option 5 — Store members in a separate MongoDB collection (instead of ClickHouse).**
Moves membership to a second MongoDB collection rather than ClickHouse. This does not solve the reliability problem: it is still a dual-write (Group document + member collection) with the same split-state risk unless also done as an outbox, and it reintroduces the scale ceiling for very large / high-churn membership that the append-only ClickHouse event model handles well. *Rejected:* the storage choice is not the gap; the write-coordination is.

## Recommendation

Adopt **Option 4** (synchronous-write + durable-outbox hybrid) as the target, pending this review. It satisfies every driver: no lost writes, no split state, scale, read-after-write in the normal case, and alignment with the platform's transactional-outbox mandate. As an interim before the outbox lands, prefer **Option 2** (fail clean) over shipping Option 1's compensation as a permanent design — but the currently-open PR keeps the Option 1 compensation for now, so it is documented in ADR 0003 as interim and this ADR is the path to replace it.

## Consequences

- Removes the members-in-Mongo compensation and its split-state / scale defects.
- Introduces an outbox collection and a relay (worker/consumer) with backoff + DLQ — new infrastructure that must go through the normal approved-tech / Terraform review. Idempotency reuses the existing deterministic `event_id`.
- Membership becomes eventually consistent **only under ClickHouse unavailability**; in the healthy path it stays read-after-write.
- Requires a migration/rollout plan coordinated with the current ClickHouse schema work.
- The current interim compensation (ADR 0003) is retired once this lands.

## Open Questions (for the review)

1. **Consumer read-your-writes dependency.** Do any consumers depend on synchronous membership visibility (write members, then immediately read `quantity` or member-search and expect them current)? The hybrid preserves this in the healthy path; confirm no consumer needs a stronger guarantee than FHIR mandates.
2. **Outbox mechanism.** Mongo-transaction outbox + a dedicated relay, versus reusing the existing platform event bus (Kafka/CloudEvents) as the outbox transport. The latter may align better with the event-driven baseline.
3. **Relay ownership / DLQ handling** and the reconciliation story for the (now much narrower) failure windows.

## References

- EA-2329 (this Tech Design Review)
- [ADR 0003](0003-clickhouse-group-tenant-isolation-and-idempotency.md) (tenant isolation + idempotency; documents the interim compensation)
- FHIR R4 `http.html` (update/read semantics, versioning), `search.html` (search currency)
- Org `CLAUDE.md` distributed-systems baseline (sagas, transactional outbox, eventual consistency)
