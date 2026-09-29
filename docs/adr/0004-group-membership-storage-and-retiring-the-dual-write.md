# Group Membership Storage, and Retiring the Dual-Write

## Status

**Proposed** — EA-2329. Supersedes the earlier draft of this ADR, which proposed making the
MongoDB/ClickHouse dual-write reliable via a transactional outbox. This ADR reaches the opposite
conclusion: the dual-write should be removed rather than made reliable.

Renumbered from 0005 to 0004 because `main` took 0003 for Atlas Search. The causal-ordering ADR on
the EA-2326 branch should take 0005.

**Scope:** which store owns Group membership, and what each store is for. It does not change the
FHIR contract.

## Context

`Group.member[]` is a FHIR `BackboneElement` stored inline in the Group document, so MongoDB's 16MB
per-document BSON limit caps a roster well below what DQM and Health Match cohorts need. Three
answers to that now exist in the codebase:

1. **Embedded.** Roster inline. The default, and correct for the overwhelming majority of Groups.
2. **Mongo + ClickHouse event log.** EA-2126. Metadata in Mongo, membership as an append-only
   ClickHouse event log with two `AggregatingMergeTree` current-state views maintained by
   materialized views. Routed by config plus a per-request `useExternalStorage` header.
3. **Mongo-native "extended."** DCON-5473. Roster in `GroupMember_4_0_0` with a parallel history
   collection, one document per membership, written through the shared resource-write pipeline.
   Routed by an internal per-document `_extended` marker. Merged 2026-09-25, flag off.

The earlier draft of this ADR considered regime 3 as "Option 5" and rejected it, on the reasoning
that *"the storage choice is not the gap; the write-coordination is."*

**That reasoning was wrong, and identifying why is the substance of this ADR.** It assumed ClickHouse
would remain authoritative for membership reads, in which case moving the roster to a second Mongo
collection really would leave a dual-write needing an outbox. But if Mongo serves the membership
reads, ClickHouse stops being authoritative for anything a FHIR read touches, and there is no
dual-write left to coordinate. The reliability problem dissolves rather than needing to be solved.

## Decision

**MongoDB owns current membership and serves the entire FHIR surface** for it: read, search,
`$export` seeding, `$graph`, `$everything`.

**ClickHouse keeps the membership event log and nothing else.** `Group_4_0_0_MemberCurrent` and
`Group_4_0_0_MemberCurrentByEntity`, and their materialized views, are dropped.

**The event log is fed one way, never dual-written.** ClickHouse is downstream of Mongo, not a
co-authority. Transport is a separate decision, costed in EA-2677.

## Evidence

Measured through one load harness switching between regimes with identical batch sizes and
checkpoints (`src/tests/integration/performance/group/extended_group_scale.test.js`), both regimes
driven to 10,000,000 members through the real PATCH path.

**These are testcontainer figures on a single laptop: one node, localhost, no concurrent load, one
Group in the table. ClickHouse Cloud separates compute from storage and has more cores, so absolute
numbers will move, likely by a lot. The shape is what carries the decision.**

Forward page of 100 members:

| members | Mongo | ClickHouse |
|---|---|---|
| 100K | 3ms | 26-38ms |
| 1M | 3-8ms | 64-167ms |
| 5M | 6ms | 1,190ms |
| 10M | 6ms | 5,941ms |

Mongo is flat because `groupUuid` makes a page O(page size). ClickHouse grows with group size
because `argMaxMerge` plus `GROUP BY` must merge every part for the `group_id` before `LIMIT`
applies, so a page costs O(members in group). More cores make that faster, not flat. This is also
the mechanical cause of the socket instability EA-2320 addresses: the resets were O(group size)
reads timing out.

ClickHouse wins where its shape fits. Writes ran 24,000-27,000/s against Mongo's 2,400-2,600/s
across the whole range, neither degrading. The event log costs a consistent 62 bytes per event,
against roughly 724MB per million members in Mongo. A time-filtered scan over 10,000,000 events
answering "who joined during this window" ran in 712ms.

And the two current-state views are 89% of ClickHouse's Group footprint (1,655MB + 793MB of 2,758MB
at 5M members), because `AggregateFunction(argMax, T, Tuple(DateTime64, UUID))` carries a 24-byte tie
tuple per column across roughly 17 columns. They are simultaneously the storage cost and the latency
cost, which is why dropping them is not a compromise.

## What ClickHouse is for here

The event log answers questions Mongo cannot express today, and they are not marginal:

- **Continuous enrollment for DQM.** "Was this person in the cohort for the whole measurement
  period." Needs `event_type` and `event_time` as queryable columns.
- **Cohort set operations for Health Match.** Eligible for one trial and not already enrolled in
  another, cohort overlap, denominators across millions of members. Mongo serves one roster fast and
  cannot intersect two multi-million-member cohorts without materialising both.

A roster page is neither of those, which is the whole point of the split.

## What this retires

- **EA-2322's compensating delete.** There is no split brain to compensate once Mongo is the only
  authority for membership.
- **The transactional outbox** the earlier draft of this ADR recommended. It existed to make a
  dual-write safe; there is no dual-write.
- **EA-2326's destructive re-key migration** and the `group_uuid` re-key of the materialized views.
  Dropping the views removes the identity defect outright. No environment currently runs
  `ENABLE_CLICKHOUSE` with `MONGO_WITH_CLICKHOUSE_RESOURCES=Group`, so this is a schema change with
  no data to migrate.
- **The `useExternalStorage` header as a routing mechanism.** A permanent per-Group marker is
  strictly better than a per-request header for what is a permanent per-Group property, and EA-2317's
  objection to the header is answered by construction rather than by re-scoping.

## What this requires

- **The lifecycle event type recorded at the source.** DCON-5530. The write path computes
  create/update/delete (`mongoBulkWriteExecutor.js:574`) and discards it, so history carries only
  `request.method`, which is `PATCH` for both a create and an update. The distinction is derivable
  from full history snapshots, and that derivation breaks under concurrent writes (DCON-5800) and
  dies entirely when history migrates to cloud storage, which strips `request.method` first. This is
  the gate on everything else.
- **A deterministic event id.** `groupMemberEventBuilder.js:101` uses `uuidv4()`, so no retry is
  idempotent under any transport. It should derive from the causal tuple, which is what EA-2326
  defines.
- **Group writes stop blocking on ClickHouse.** `clickHouseGroupHandler.js:79-82` blocks with the
  comment *"ClickHouse is the authoritative source for member data"*, a premise this ADR removes.
- **A transport decision.** EA-2677 costs direct write against Kafka/ClickPipes.
- **A bulk ingest path.** Mongo's 10x slower writes put a 20M-member cohort rebuild in hours rather
  than minutes. That argues for a bulk writer, not for ClickHouse serving reads.

## What this does not touch

`STORAGE_PROVIDER_TYPES.CLICKHOUSE` and the generic ClickHouse-only scaffolding
(`clickHouseStorageProvider.js`, `clickHouse/schemaRegistry.js`, `genericClickHouseRepository.js`,
`genericClickHouseQueryBuilder.js`, `clickHouseBulkWriteExecutor.js`) are unaffected; none of them
reference the Group current-state views. AuditEvent and AccessLog stay as they are. Whether
terminology and wearable-telemetry Observation belong on ClickHouse-only storage are separate
questions on their own evidence, and this ADR takes no position on either.

`STORAGE_PROVIDER_TYPES.MONGO_WITH_CLICKHOUSE` becomes unused for Group. Leave the type in place; it
is the right abstraction for a future array-offload case and costs nothing idle.

## FHIR conformance

Carried forward from the earlier draft, because it still holds and now applies to the event log
rather than to membership itself.

- **Read-after-write is a SHOULD, not a SHALL.** `http.html`: a server "SHOULD ... return the same
  content when it is subsequently read. However systems might not be able to do this." The only hard
  SHALL is that `meta.versionId` and `meta.lastUpdated` are populated correctly.
- **Search is explicitly eventually consistent.** `search.html`: results "are only guaranteed to be
  current at the instant the operation is executed."

Under this ADR the membership a FHIR read returns comes from Mongo and is strongly consistent, which
is *stronger* than the earlier design offered. The eventual consistency moves to the analytical event
log, where nothing in the FHIR contract depends on it. That is a better place for it.

Cohort enumeration remains `Group/[id]/$export` rather than an inline `member[]` read or a custom
`$members` operation, consistent with Bulk Data server-side expansion and with the DQM external
contract's commitment to standard DEQM `$evaluate`.

## Consequences

- One authority for membership, so no reconciliation story is needed.
- ClickHouse storage for Groups drops by roughly 89%, and the O(group size) read cost disappears.
- The analytical plane becomes contingent on DCON-5530. If the event type is never recorded, the
  event log replicates snapshots with no lifecycle signal and cannot answer the questions it exists
  for. Indexes can be added to a populated collection; an event never written cannot be backfilled.
- Mongo absorbs the write-throughput cost, and the bulk path becomes real work rather than a
  nice-to-have.
- Mongo history is **not** a CDC source in the usual sense: there are no change streams anywhere in
  this codebase, no outbox, and history writes are post-response with failures swallowed
  (`postRequestProcessor.js:99-116`). A downstream consumer must poll, and that needs a lookback
  window because rows can land late and out of `lastUpdated` order.

## Open questions

1. **Transport.** EA-2677.
2. **Who may read the event log, and with what freshness guarantee.** Needs stating as a contract
   rather than assumed, since the lag window is acceptable only while nothing expects read-after-write.
3. **Provenance.** EA-2678. The event log declares `actor`, `reason`, `source` and `correlation_id`
   and has never populated any of them.
4. **Whether `MONGO_WITH_CLICKHOUSE` retains a consumer** after Group leaves it.

## References

- EA-2329 (this review), EA-2677 (transport decision), EA-2678 (provenance)
- DCON-5473 (Mongo-native membership epic), DCON-5530 (history contract), DCON-5799 (`$export` gap),
  DCON-5800 (concurrent version collision)
- ADR 0001 (schema registry for ClickHouse-only resources)
- `policies/approved-tech.yaml:146` — ties EA-2126 to resources exceeding the 16MB BSON limit and
  warns it is "not a blanket approval to use ClickHouse as a general operational datastore"
- FHIR R4 `http.html`, `search.html`; Bulk Data Access IG `Group/[id]/$export`
- `src/tests/integration/performance/group/extended_group_scale.test.js` (the measurements above)
