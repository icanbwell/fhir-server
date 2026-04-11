# MongoDB as an Alternate for Group Members Scaling

## Table of Contents

- [The Problem](#the-problem)
- [The Solution](#the-solution)
- [How It Works](#how-it-works)
  - [Event-Sourced Architecture](#event-sourced-architecture)
  - [Document Structure](#document-structure)
  - [Current State View](#current-state-view)
  - [Indexes](#indexes)
- [Request Flow](#request-flow)
  - [Activation](#activation)
  - [Write Path (PATCH -- Recommended)](#write-path-patch----recommended)
  - [Write Path (PUT -- Alternative)](#write-path-put----alternative)
  - [Read Path](#read-path)
  - [Coexistence with ClickHouse](#coexistence-with-clickhouse)
- [API Usage](#api-usage)
  - [Creating a Group](#creating-a-group)
  - [Adding Members via PATCH (Recommended)](#adding-members-via-patch-recommended)
  - [Adding Members via PUT](#adding-members-via-put)
  - [Searching by Member](#searching-by-member)
  - [Removing Members](#removing-members)
- [Performance Benchmarks](#performance-benchmarks)
  - [Test Environment](#test-environment)
  - [Write Speed](#write-speed)
  - [Read Speed](#read-speed)
  - [PATCH Operation Limits](#patch-operation-limits)
  - [Write Consistency at Scale](#write-consistency-at-scale)
- [MongoDB Storage Stats](#mongodb-storage-stats)
  - [Event Collection at Scale](#event-collection-at-scale)
  - [Index Breakdown at 1M](#index-breakdown-at-1m)
  - [Per-Member Storage Cost](#per-member-storage-cost)
- [When to Use Which](#when-to-use-which)
- [Configuration](#configuration)
- [Running the Performance Tests](#running-the-performance-tests)

---

## The Problem

MongoDB's 16MB BSON document limit restricts Group resources to approximately 50K--100K embedded members. Beyond that, the document exceeds the limit and writes fail.

The existing solution uses **ClickHouse** as a separate datastore -- an event-sourced dual-write model where MongoDB stores Group metadata and ClickHouse stores member events. This works well but requires deploying and operating a second database system (ClickHouse cluster, monitoring, backups, network configuration).

**Goal:** Provide a MongoDB-native alternative that eliminates the 16MB limit without requiring additional infrastructure.

---

## The Solution

An **event-sourced member storage model within MongoDB itself**. Instead of embedding members inside the Group document, member changes are stored as append-only events in a separate collection. A MongoDB standard view computes current membership state on read.

| | Embedded Members (Default) | ClickHouse (Existing) | MongoDB Members (New) |
|---|---|---|---|
| **Storage** | Array inside Group document | ClickHouse event table + materialized views | MongoDB event collection + standard view |
| **Scale limit** | ~50K--100K members | 1M+ tested | 1M+ tested |
| **Infrastructure** | MongoDB only | MongoDB + ClickHouse cluster | MongoDB only |
| **Read performance at 1M** | N/A (hits 16MB limit) | ~160ms (pre-computed) | ~7.5s (aggregation pipeline) |
| **Write performance at 1M** | N/A | ~17.6s (no validation) | ~109.7s (with reference validation) |
| **Audit trail** | No history | Full event log | Full event log |

---

## How It Works

### Event-Sourced Architecture

Three MongoDB objects work together:

```
Group_4_0_0                    Group resource metadata (member array always stripped to [])
Group_4_0_0_MemberEvent        Append-only event log (one document per add/remove)
Group_4_0_0_MemberCurrent      Standard view computing current state via $sort + $group + $first
```

Instead of modifying an embedded array, every membership change creates an immutable event:

```
Event Log                                  Current State (Derived by View)
─────────────────────────────────          ───────────────────────────────
event_type='added':   Patient/1 @ 10:00   → Patient/1: active
event_type='added':   Patient/2 @ 10:05   → Patient/2: active
event_type='removed': Patient/1 @ 10:10   → Patient/1: removed
event_type='added':   Patient/1 @ 10:15   → Patient/1: active (re-added)
```

Current state is derived by the MongoDB view, which groups events by `(group_id, member_type, member_object_id)` and takes the latest event using `$sort` by `_id` (descending) + `$first`.

### Document Structure

Each member add or remove produces one document in `Group_4_0_0_MemberEvent`:

```javascript
{
  _id: ObjectId(),                    // Monotonic ordering (natural tie-breaker)
  group_id: ObjectId("..."),          // Group _id (12-byte, compact indexes)
  group_uuid: "Group/group-123",      // Group _uuid string (FHIR resolution)
  member_type: "Patient",             // Denormalized resource type
  member_object_id: ObjectId("..."),  // Referenced resource _id (compact indexes)

  event_type: "added" | "removed",
  event_time: ISODate,

  entity: {                           // FHIR-native format
    _uuid: "Patient/<uuid>",
    _sourceId: "Patient/<id>",
    reference: "Patient/<id>"
  },
  period: { start: ISODate, end: ISODate },
  inactive: false
}
```

**Design note:** `group_id` and `member_object_id` store MongoDB ObjectIds (12 bytes) instead of string UUIDs (~36 bytes). This makes compound indexes approximately 40% smaller. The string identifiers are stored separately in `group_uuid` and `entity` for FHIR reference resolution. The ObjectId resolution happens at write time.

### Current State View

The `Group_4_0_0_MemberCurrent` view computes the latest event per unique (group, member) pair:

```javascript
db.createView("Group_4_0_0_MemberCurrent", "Group_4_0_0_MemberEvent", [
  { $sort: { group_id: 1, member_type: 1, member_object_id: 1, _id: -1 } },
  { $group: {
    _id: { group_id: "$group_id", member_type: "$member_type",
           member_object_id: "$member_object_id" },
    group_id: { $first: "$group_id" },
    group_uuid: { $first: "$group_uuid" },
    member_type: { $first: "$member_type" },
    member_object_id: { $first: "$member_object_id" },
    entity: { $first: "$entity" },
    period: { $first: "$period" },
    inactive: { $first: "$inactive" },
    event_type: { $first: "$event_type" },
    event_time: { $first: "$event_time" }
  }}
]);
```

### Indexes

Two compound indexes on the event collection:

| Index Name | Fields | Use Case |
|---|---|---|
| `groupId_memberType_memberObjectId_id` | `{ group_id: 1, member_type: 1, member_object_id: 1, _id: -1 }` | Get all members of a specific Group |
| `memberType_memberObjectId_groupId_id` | `{ member_type: 1, member_object_id: 1, group_id: 1, _id: -1 }` | Reverse lookup: which Groups contain Patient X? |

---

## Request Flow

### Activation

The feature activates only when **both** conditions are true:

1. **Environment variable:** `ENABLE_MONGO_GROUP_MEMBERS=1`
2. **Per-request header:** `subGroupMemberRequest: true`

Without the header, the standard flow (ClickHouse or embedded) handles the request.

### Write Path (PATCH -- Recommended)

PATCH is the recommended pattern for large Groups. Each PATCH sends only the new members (not the full array), making it network-efficient and scalable.

```
PATCH /4_0_0/Group/{id} + Header: subGroupMemberRequest: true
  → groupMemberPatchStrategy detects member operations
  → Selects MongoGroupMemberHandler (based on header)
  → handler.writeEventsAsync(groupId, added, removed)
  → mongoGroupMemberRepository.appendEvents()
      1. Resolve Group ObjectId
      2. Batch-resolve member ObjectIds (validates references exist)
      3. Transform events to MongoDB documents
      4. collection.insertMany() → Group_4_0_0_MemberEvent
  → Update Group metadata in MongoDB (versionId, lastUpdated only)
  → Response returned
```

**Key point:** PATCH is a pure append operation -- it does not read existing members from the view. This makes it fast even for Groups with 1M+ members.

### Write Path (PUT -- Alternative)

PUT sends the full member array; the server computes the diff automatically.

```
PUT /4_0_0/Group/{id} + Header: subGroupMemberRequest: true
  → contextDataBuilder stores original member array
  → databaseBulkInserter validates references, strips member array
  → MongoDB saves Group metadata (member: [])
  → MongoGroupMemberHandler.afterSaveAsync()
      1. Read current members from Group_4_0_0_MemberCurrent view
      2. GroupMemberDiffComputer computes additions/removals
      3. mongoGroupMemberRepository.appendEvents(diffEvents)
  → Response returned
```

**Limitation:** PUT requires reading the full current state for diff computation, and HTTP payload size limits cap it at ~50K members per request.

### Read Path

```
GET /4_0_0/Group/{id}
  → MongoGroupMemberEnrichmentProvider checks header + config
  → Queries Group_4_0_0_MemberCurrent view for count
  → Sets response.quantity = member count
  → Strips member array from response
  → Returns Group metadata with quantity
```

Members are never returned in the Group response body. The `quantity` field reflects the active member count.

### Coexistence with ClickHouse

Both backends can be enabled simultaneously. Per-request routing uses the `contextData.useMongoGroupMembers` flag:

| Request | ClickHouse Handler | MongoDB Handler |
|---|---|---|
| **Without** `subGroupMemberRequest: true` | Processes | Skips |
| **With** `subGroupMemberRequest: true` | Skips | Processes |

---

## API Usage

All standard FHIR operations work with the `subGroupMemberRequest: true` header.

### Creating a Group

```bash
POST /4_0_0/Group
Content-Type: application/fhir+json
subGroupMemberRequest: true

{
  "resourceType": "Group",
  "type": "person",
  "actual": true,
  "name": "My Patient Cohort",
  "member": [
    { "entity": { "reference": "Patient/1" } },
    { "entity": { "reference": "Patient/2" } },
    { "entity": { "reference": "Patient/3" } }
  ]
}
```

Response: `201 Created` with Group metadata (member array is empty in responses -- member data lives in the event collection).

### Adding Members via PATCH (Recommended)

For large Groups (10K+ members), use PATCH to add members incrementally:

```bash
PATCH /4_0_0/Group/{id}
Content-Type: application/json-patch+json
subGroupMemberRequest: true

[
  { "op": "add", "path": "/member/-", "value": { "entity": { "reference": "Patient/5001" } } },
  { "op": "add", "path": "/member/-", "value": { "entity": { "reference": "Patient/5002" } } },
  ...
  { "op": "add", "path": "/member/-", "value": { "entity": { "reference": "Patient/10000" } } }
]
```

**Why PATCH is recommended:**
- Only sends new members, not the entire array
- No request size limit (10K operation limit per PATCH, configurable)
- Direct event writes without reading existing state
- Smaller payloads (KB vs MB)

### Adding Members via PUT

PUT sends the full member array; the server computes the diff automatically:

```bash
PUT /4_0_0/Group/{id}
Content-Type: application/fhir+json
subGroupMemberRequest: true

{
  "resourceType": "Group",
  "id": "{id}",
  "type": "person",
  "actual": true,
  "member": [
    /* Include ALL previous members + new ones */
  ]
}
```

### Searching by Member

```bash
GET /4_0_0/Group?member=Patient/123
```

### Removing Members

Use PATCH to remove specific members:

```bash
PATCH /4_0_0/Group/{id}
Content-Type: application/json-patch+json
subGroupMemberRequest: true

[
  {
    "op": "remove",
    "path": "/member",
    "value": { "entity": { "reference": "Patient/123" } }
  }
]
```

---

## Performance Benchmarks

### Test Environment

All numbers measured on the same machine in the same session for fair comparison.

- **Machine:** MacBook Air (Apple Silicon)
- **MongoDB:** 8.0.15 Docker container (ephemeral, no volumes)
- **ClickHouse:** 24.8 Docker container (ephemeral, no volumes)
- **Test harness:** `docker-compose-test.yml` with isolated databases

### Write Speed

| Operation | MongoDB Members | ClickHouse | Ratio |
|---|---|---|---|
| PATCH 100 ops | 60ms | 74ms | MongoDB 1.2x faster |
| PATCH 1K ops | 122ms | 70ms | ClickHouse 1.7x faster |
| PATCH 5K ops | 252ms | 131ms | ClickHouse 1.9x faster |
| PATCH 10K ops | 348ms | 182ms | ClickHouse 1.9x faster |
| 50K via PATCH (5K x 10) | 2.97s | 1.74s | ClickHouse 1.7x faster |
| PUT with diff (10K, 1K batches) | 5.96s | 5.77s | ~Equal |
| **1M via PATCH (10K x 100)** | **109.72s** | **17.61s** | **ClickHouse 6.2x faster** |

**Why the difference at scale:** MongoDB Members validates that every referenced resource exists by resolving ObjectIds at write time (e.g., confirming `Patient/123` actually exists in `Patient_4_0_0`). ClickHouse does not perform this validation. This accounts for most of the gap at scale.

### Read Speed

| Operation | MongoDB Members | ClickHouse | Ratio |
|---|---|---|---|
| Member count (10K) | 47ms | 34ms | ClickHouse 1.4x faster |
| Member count (50K) | 289ms | 53ms | ClickHouse 5.5x faster |
| **Member count (1M)** | **7,465ms** | **160ms** | **ClickHouse 47x faster** |
| Member search (100 members) | 233ms | -- | -- |
| Member search (1K members) | 289ms | -- | -- |
| Member search (5K members) | 418ms | -- | -- |

**Why the difference:** MongoDB uses a standard view that runs the full aggregation pipeline (`$sort` + `$group` + `$first`) on every query. ClickHouse uses materialized views (`AggregatingMergeTree`) with pre-computed aggregate state, so count performance stays near-constant regardless of data size.

### PATCH Operation Limits

| Operations per PATCH | MongoDB Members | ClickHouse |
|---|---|---|
| 100 | 60ms (200 OK) | 74ms (200 OK) |
| 1,000 | 122ms (200 OK) | 70ms (200 OK) |
| 5,000 | 252ms (200 OK) | 131ms (200 OK) |
| 10,000 | 348ms (200 OK) | 182ms (200 OK) |
| 25,000 | rejected (400) | rejected (400) |
| 50,000 | rejected (400) | rejected (400) |

Both hit the same default 10K operation limit (configurable via `GROUP_PATCH_OPERATIONS_LIMIT`).

### Write Consistency at Scale

Batch times remain constant as the collection grows (measured during 1M member loading, 100 batches of 10K):

| Metric | MongoDB Members | ClickHouse |
|---|---|---|
| Min batch time | 1,043ms | 133ms |
| Max batch time | 1,303ms | 335ms |
| Trend | Flat (no degradation) | Flat (no degradation) |

---

## MongoDB Storage Stats

All measurements from Docker MongoDB 8.0.15 on MacBook Air (Apple Silicon), isolated `fhir_perf_test` database.

### Event Collection at Scale

| Scale | Documents | Data Size | Storage Size | Avg Doc | Index Size | Total On Disk |
|---|---|---|---|---|---|---|
| 10K members | 10,000 | 3.38MB | 1.19MB | 354 bytes | 0.36MB | 1.55MB |
| 60K members | 60,000 | 20.96MB | 6.39MB | 366 bytes | 1.06MB | 7.45MB |
| 1M members | 1,000,000 | 342.16MB | 73.58MB | 358 bytes | 71.97MB | 145.55MB |

WiredTiger compression ratio improves at scale: 2.8x at 10K → 3.3x at 60K → 4.65x at 1M.

### Index Breakdown at 1M

| Index | Size | Per Document |
|---|---|---|
| `groupId_memberType_memberObjectId_id` | 23.6MB | ~24 bytes |
| `memberType_memberObjectId_groupId_id` | 37.6MB | ~38 bytes |
| `_id_` | 10.8MB | ~11 bytes |
| **Total** | **71.97MB** | **~72 bytes** |

### Per-Member Storage Cost

| Metric | Value |
|---|---|
| Raw data per member | 358 bytes |
| Compressed storage per member | 73.6 bytes |
| Index overhead per member | 72 bytes |
| **Total on-disk per member** | **~146 bytes** |

At this rate, 1M members costs approximately 146MB on disk. Patient stubs used for reference validation in tests are not included -- in production, Patient resources already exist.

---

## When to Use Which

| Consideration | MongoDB Members | ClickHouse |
|---|---|---|
| **Additional infrastructure** | None (uses existing MongoDB) | Requires ClickHouse cluster |
| **Operational complexity** | Single database to manage | Two databases to manage |
| **Write speed (1M)** | ~110s (with reference validation) | ~18s (no validation) |
| **Read speed (1M count)** | ~7.5s | ~160ms |
| **Audit trail** | Full event history | Full event history |
| **Best for** | Environments without ClickHouse; cost-sensitive deployments; groups where multi-second read latency is acceptable | Read-heavy workloads; need for sub-200ms reads at 1M+; environments where ClickHouse is already deployed |

---

## Configuration

```bash
# Enable MongoDB Group Members (disabled by default)
ENABLE_MONGO_GROUP_MEMBERS=1

# Optional: max PATCH operations per request (default: 10000)
GROUP_PATCH_OPERATIONS_LIMIT=10000

# Optional: max members per PUT request (default: 50000)
MAX_GROUP_MEMBERS_PER_PUT=50000
```

### Coexistence with ClickHouse

Both backends can be enabled simultaneously:

```bash
ENABLE_CLICKHOUSE=1
MONGO_WITH_CLICKHOUSE_RESOURCES=Group
ENABLE_MONGO_GROUP_MEMBERS=1
```

- Request **without** `subGroupMemberRequest: true` → ClickHouse handles members
- Request **with** `subGroupMemberRequest: true` → MongoDB handles members

---

## Running the Performance Tests

```bash
# Start test containers (ephemeral, no volumes)
docker compose -f docker-compose-test.yml up -d mongo

# MongoDB Members: Incremental loading (PUT + PATCH patterns, ~60K members)
nvm use && node node_modules/.bin/jest src/tests/performance/group/mongo_member_incremental_loading.test.js

# MongoDB Members: PATCH operation limits + search performance
nvm use && node node_modules/.bin/jest src/tests/performance/group/mongo_member_patch_performance.test.js

# MongoDB Members: 1M member loading (100 PATCHes x 10K ops, ~2.5 min)
nvm use && node node_modules/.bin/jest src/tests/performance/group/mongo_member_1m_patch.test.js

# ClickHouse: Start ClickHouse container
docker compose -f docker-compose-test.yml up -d clickhouse

# ClickHouse: Incremental loading (PUT + PATCH patterns)
nvm use && node node_modules/.bin/jest src/tests/performance/group/incremental_loading.test.js

# ClickHouse: PATCH operation limits
nvm use && node node_modules/.bin/jest src/tests/performance/group/patch_performance.test.js
```

Tests use `docker-compose-test.yml` (no volume mounts) with isolated databases, so your development data is not affected.
