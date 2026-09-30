# Group Membership Storage, and Retiring the Dual-Write

## Status

**Proposed** — EA-2329.

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

Regime 2 makes a single Group write a dual-write across two stores with no shared transaction: the
Mongo document commits with `member[]` stripped, then the ClickHouse events are written. That is the
source of the reliability work tracked under EA-2322 (compensating delete on failure) and EA-2326
(causal ordering), and the reason a transactional outbox looks necessary.

**It only looks necessary while ClickHouse is authoritative for membership reads.** If Mongo serves
those reads, ClickHouse is no longer authoritative for anything a FHIR read touches, and there is no
dual-write left to coordinate. The reliability problem dissolves rather than needing to be solved,
which is a better outcome than solving it.

## Decision

**MongoDB owns current membership and serves the entire FHIR surface** for it: read, search,
`$export` seeding, `$graph`, `$everything`.

**Both ClickHouse current-state views are dropped.** `Group_4_0_0_MemberCurrent` and
`Group_4_0_0_MemberCurrentByEntity`, and their materialized views, go away.

**Whether ClickHouse retains a membership event log at all is deferred**, pending a verified consumer.
See "The analytical plane is deliberately unresolved" below. Nothing in this ADR depends on that
answer, and no dual write survives either way: if an event log is kept it is fed one way, downstream
of Mongo, never as a co-authority.

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

## The analytical plane is deliberately unresolved

An earlier version of this decision kept a ClickHouse membership event log and justified it on two
consumers. Both were checked against the code and neither holds.

**DQM does not read Group membership, and evaluates per person.**
`PopulationResolutionService` in `clinical-reasoning-orchestrator-service` resolves a population by
keyset-paginating a **Person** search (`_elements=id,identifier,link`, `_sort=_uuid`, `_id:above`
cursor) and creating one work unit per person. The population is defined by a caller-supplied Person
query; `Group` appears nowhere in that path. The planned enhancement accepts a Group but keeps
per-person evaluation, which makes the Group's role a single roster enumeration per run. Enumeration
and per-person reads are both Mongo's shape, and ClickHouse is actively worse at both: a page of 100
costs 1,190ms at 5M members against Mongo's 6ms. Even continuous enrollment favours Mongo when it is
asked per person, because that is an indexed lookup on one member's rows. ClickHouse would only win
if the question were asked as a set, which is not how the engine works.

**Health Match cohort discovery was already settled on OpenSearch.** *Optimized Real-Time Cohort
Matching Architecture* (Confluence PRG 5341872218) keeps Group canonical and mirrors membership into
OpenSearch with `cohort_ids[]` denormalised onto the patient document, making intersection and
trial-criteria matching a terms filter rather than a join. Cohort building is predominantly a query
over clinical data, and the prerequisite for doing that in ClickHouse would be clinical data in
ClickHouse, which does not exist.

So **no verified consumer currently requires set-based temporal membership**, which is the only thing
a ClickHouse event log would uniquely provide. Rather than assert one, this ADR drops the views and
leaves the event log open.

Two things to weigh when it is picked up:

- **Most Group analytics are batch, which is Databricks rather than ClickHouse.** Population-scale
  measure computation, cohort churn, risk adjustment, ML features and regulatory reporting are all
  batch with lineage requirements. Databricks is approved (`approved-tech.yaml:148-151`) and Sigma
  already reads Delta in production. ClickHouse's niche is the narrow band of analytical *and*
  interactive.
- **Delta time travel may remove the need for a bespoke event log entirely.** A membership table
  queryable as-of-timestamp gives point-in-time and interval logic without an append-only log, a
  deduplication story, or a causal tie tuple.

ClickHouse's own profile, evidenced by AuditEvent and AccessLog working well there, is append-only
data that never mutates and is read interactively. Group membership fails the first two tests for
current state. On that same profile the strongest untried FHIR candidates are **resource version
history** (today shipped to object storage by a cron that strips the document to four allowlisted
fields, making it unqueryable) and **MeasureReport**. Both need their own Tech Design Review, per the
registry note at `approved-tech.yaml:146`.

## What this retires

- **EA-2322's compensating delete.** There is no split brain to compensate once Mongo is the only
  authority for membership.
- **The need for a transactional outbox** on this path. An outbox makes a dual-write safe; there is
  no dual-write.
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
  needed for DCON-5530's own point-in-time reconstruction, independently of anything analytical.
- **Group writes stop blocking on ClickHouse.** `clickHouseGroupHandler.js:79-82` blocks with the
  comment *"ClickHouse is the authoritative source for member data"*, a premise this ADR removes.
- **Indexes on `GroupMember_4_0_0_History`.** DCON-5527 specified two and neither shipped;
  `customIndexes.js` imports `GROUP_MEMBER_COLLECTION_NAME` only. Without them, per-member history
  scans are collection scans. Note also that two of the three indexes that *did* ship on the live
  collection serve a reverse lookup not yet implemented, so the set is currently inverted against
  usage.
- **A bulk ingest path.** Mongo's 10x slower writes put a 20M-member cohort rebuild in hours rather
  than minutes. That argues for a bulk writer into Mongo, not for ClickHouse serving reads.

Only if an event log is kept:

- **A deterministic event id.** `groupMemberEventBuilder.js:101` uses `uuidv4()`, so no retry is
  idempotent under any transport. It should derive from the causal tuple, which is what EA-2326
  defines. Note that the emit path already has everything else it needs: `afterSaveAsync` receives
  `eventType` (`'C'`/`'U'` at `mongoBulkWriteExecutor.js:574`, `'D'` at `removeHelper.js:195-196`)
  plus the full document and `requestId`, and nothing consumes it for `GroupMember` only because
  `clickHouseGroupHandler.getHandledResourceTypes()` returns `['Group']`.
- **A transport decision.** EA-2677.

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

A standing objection to moving membership off the synchronous ClickHouse write is that it breaks FHIR
read-after-write. Validated against R4, that does not hold:

- **Read-after-write is a SHOULD, not a SHALL.** `http.html`: a server "SHOULD ... return the same
  content when it is subsequently read. However systems might not be able to do this." The only hard
  SHALL is that `meta.versionId` and `meta.lastUpdated` are populated correctly.
- **Search is explicitly eventually consistent.** `search.html`: results "are only guaranteed to be
  current at the instant the operation is executed."

The objection does not need to be answered here anyway: membership served from Mongo is strongly
consistent, so no FHIR-visible read lags at all. Any eventual consistency lands on an analytical
replica, where nothing in the FHIR contract depends on it.

Cohort enumeration remains `Group/[id]/$export` rather than an inline `member[]` read or a custom
`$members` operation, consistent with Bulk Data server-side expansion and with the DQM external
contract's commitment to standard DEQM `$evaluate`.

## Consequences

- One authority for membership, so no reconciliation story is needed.
- ClickHouse storage for Groups drops by roughly 89%, and the O(group size) read cost disappears.
- The analytical plane is left open rather than decided, which is a deliberate cost: anyone wanting
  set-based temporal membership has to establish the consumer first. The upside is that no second
  store is committed to on an unverified requirement.
- DCON-5530's own point-in-time reconstruction still depends on the lifecycle event being recorded.
  Indexes can be added to a populated collection; an event never written cannot be backfilled.
- Mongo absorbs the write-throughput cost, and the bulk path becomes real work rather than a
  nice-to-have.
- Mongo history is **not** a CDC source in the usual sense: there are no change streams anywhere in
  this codebase, no outbox, and history writes are post-response with failures swallowed
  (`postRequestProcessor.js:99-116`). A downstream consumer must poll, and that needs a lookback
  window because rows can land late and out of `lastUpdated` order.

## Open questions

1. **Is there a consumer that needs set-based temporal membership?** EA-2677. If not, no second store
   is needed for Groups at all. If so, ClickHouse and Databricks are not interchangeable: interactive
   argues for one, batch with lineage for the other.
2. **Where Health Match cohort discovery lands.** The prior conclusion is OpenSearch, per *Optimized
   Real-Time Cohort Matching Architecture* (PRG 5341872218). Worth confirming against current query
   patterns, and noting OpenSearch is not itself in `approved-tech.yaml` (Elasticsearch is).
3. **Provenance.** EA-2678. The ClickHouse event log declares `actor`, `reason`, `source` and
   `correlation_id` and has never populated any of them, while `readme/clickhouse.md:18` claims
   "Every membership change preserved with provenance."
4. **Whether `MONGO_WITH_CLICKHOUSE` retains a consumer** after Group leaves it.
5. **The registry and reference architecture need revising.** `approved-tech.yaml:143-146` scopes
   ClickHouse's FHIR track to "resources that exceed MongoDB's 16MB BSON limit (e.g. Group at 1M+
   members)", and `reference-architectures/fhir-server-group-scaling.md` documents the approach this
   ADR changes.

## References

- EA-2329 (this review), EA-2677 (transport decision), EA-2678 (provenance)
- DCON-5473 (Mongo-native membership epic), DCON-5530 (history contract), DCON-5799 (`$export` gap),
  DCON-5800 (concurrent version collision)
- ADR 0001 (schema registry for ClickHouse-only resources)
- `policies/approved-tech.yaml:146` — ties EA-2126 to resources exceeding the 16MB BSON limit and
  warns it is "not a blanket approval to use ClickHouse as a general operational datastore"
- FHIR R4 `http.html`, `search.html`; Bulk Data Access IG `Group/[id]/$export`
- `src/tests/integration/performance/group/extended_group_scale.test.js` (the measurements above)
