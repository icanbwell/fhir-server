# MongoDB Group Member Storage

## What

An alternative to ClickHouse for storing Group members at scale (tested up to 1M members). Uses event-sourced storage within MongoDB itself -- no additional infrastructure.

Instead of embedding members in the Group BSON document (which hits MongoDB's 16MB limit at ~50-100K members), member changes are stored as append-only events in a separate collection. A MongoDB standard view computes current membership state on read.

## Why

MongoDB's 16MB BSON document limit caps embedded `Group.member` arrays at approximately 50-100K entries. The existing solution uses ClickHouse as a separate datastore, but that requires deploying and operating a second database system. This feature provides an alternative that:

- **Eliminates the 16MB limit** using event-sourced storage (append-only, no document growth)
- **Requires zero additional infrastructure** -- uses the same MongoDB instance
- **Coexists with ClickHouse** -- both can be enabled, per-request header selects which one handles a given Group
- **Preserves complete audit trail** -- every add/remove is an immutable event

## Implementation

### Architecture

Three MongoDB objects work together:

```
Group_4_0_0                    Group resource metadata (member array always stripped to [])
Group_4_0_0_MemberEvent        Append-only event log (one document per add/remove)
Group_4_0_0_MemberCurrent      Standard view computing current state via $sort + $group + $first
```

### Event Document Structure

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

`group_id` and `member_object_id` store MongoDB ObjectIds (12 bytes) instead of string UUIDs (~36 bytes). This makes compound indexes ~40% smaller. The string identifiers are stored separately in `group_uuid` and `entity` for FHIR reference resolution.

### View Definition

The view computes current state by taking the latest event per unique (group, member) pair:

```javascript
db.createView("Group_4_0_0_MemberCurrent", "Group_4_0_0_MemberEvent", [
  { $sort: { group_id: 1, member_type: 1, member_object_id: 1, _id: -1 } },
  { $group: {
    _id: { group_id: "$group_id", member_type: "$member_type", member_object_id: "$member_object_id" },
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

```javascript
// Primary: backs the view's $sort + $group, also serves audit trail queries
{ group_id: 1, member_type: 1, member_object_id: 1, _id: -1 }

// Reverse lookup: "which groups contain this resource?"
{ member_type: 1, member_object_id: 1, group_id: 1, _id: -1 }
```

### Request Flow

The feature activates when BOTH conditions are true:
1. Environment variable: `ENABLE_MONGO_GROUP_MEMBERS=1`
2. Per-request header: `subGroupMemberRequest: true`

```
HTTP Request (header: subGroupMemberRequest: true)
  -> contextDataBuilder sets contextData.useMongoGroupMembers = true
  -> databaseBulkInserter strips member[] from Group document
  -> Group metadata saved to Group_4_0_0 (member: [])
  -> postSaveProcessor routes to MongoGroupMemberHandler (ClickHouseGroupHandler skips)
  -> MongoGroupMemberHandler -> mongoGroupMemberRepository.appendEvents()
  -> Events written to Group_4_0_0_MemberEvent via insertMany
```

For PATCH operations (recommended path), `groupMemberPatchStrategy` selects the correct handler based on the header and calls `writeEventsAsync()` directly -- pure append, no reads.

For PUT operations, the handler reads current members from the view, computes a diff via `GroupMemberDiffComputer`, then appends only the delta events.

### Key Files

| File | Role |
|------|------|
| `src/constants/mongoGroupMemberConstants.js` | Collection/view names, header constant |
| `src/dataLayer/repositories/mongoGroupMemberRepository.js` | MongoDB data access, ObjectId resolution, format mapping |
| `src/dataLayer/postSaveHandlers/mongoGroupMemberHandler.js` | Post-save handler (writes events on create/update) |
| `src/dataLayer/providers/mongoWithMongoMembersStorageProvider.js` | Storage provider (routes member queries to view) |
| `src/enrich/providers/mongoGroupMemberEnrichmentProvider.js` | Enrichment (sets quantity from view, strips member array) |
| `src/utils/contextDataBuilder.js` | Sets `useMongoGroupMembers` flag from header |

## API Usage

All standard FHIR operations work with the `subGroupMemberRequest: true` header.

### Creating Groups

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

Response: `201 Created` with Group metadata (note: `member` array is empty in responses -- member data lives in the event collection)

### Incremental Loading with PATCH (Recommended)

**For large Groups (10K+ members), use PATCH to add members incrementally.** This is the most efficient pattern:

```bash
# Step 1: Create Group with initial batch
POST /4_0_0/Group
subGroupMemberRequest: true
{
  "resourceType": "Group",
  "type": "person",
  "actual": true,
  "member": [
    { "entity": { "reference": "Patient/1" } },
    ...
    { "entity": { "reference": "Patient/5000" } }
  ]
}

# Step 2-N: Add more members using PATCH (5K per batch)
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
- **Efficient**: Only sends new members, not entire array
- **Scalable**: No request size limit (10K operation limit per PATCH, configurable)
- **Fast**: Direct event writes without reading existing state
- **Network-friendly**: Smaller payloads (KB vs MB)

### Incremental Loading with PUT (Alternative)

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

**Limitations of PUT:**
- HTTP payload size limits (typically 6-10MB)
- Maximum ~50K members per PUT (configurable via `MAX_GROUP_MEMBERS_PER_PUT`)
- Larger payloads over network
- Requires reading current state for diff computation

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

## MongoDB Storage Stats

All measurements from Docker MongoDB 8.0.15 on MacBook Air (Apple Silicon), isolated `fhir_perf_test` database.

### Event Collection at Scale

| Scale | Documents | Data Size | Storage Size | Avg Doc | Index Size | Total On Disk |
|-------|----------|-----------|-------------|---------|-----------|--------------|
| 10K members | 10,000 | 3.38MB | 1.19MB | 354 bytes | 0.36MB | 1.55MB |
| 60K members | 60,000 | 20.96MB | 6.39MB | 366 bytes | 1.06MB | 7.45MB |
| 1M members | 1,000,000 | 342.16MB | 73.58MB | 358 bytes | 71.97MB | 145.55MB |

WiredTiger compression ratio improves at scale: 2.8x at 10K -> 3.3x at 60K -> 4.65x at 1M.

### Index Breakdown at 1M

| Index | Size | Per Doc |
|-------|------|---------|
| `groupId_memberType_memberObjectId_id` | 23.6MB | ~24 bytes |
| `memberType_memberObjectId_groupId_id` | 37.6MB | ~38 bytes |
| `_id_` | 10.8MB | ~11 bytes |
| **Total** | **71.97MB** | **~72 bytes** |

### Per-Member Cost

| Metric | Value |
|--------|-------|
| Raw data per member | 358 bytes |
| Compressed storage per member | 73.6 bytes |
| Index overhead per member | 72 bytes |
| **Total on-disk per member** | **~146 bytes** |

### Full Database Stats at 1M (including test Patient stubs)

| Collection | Documents | Data Size | Storage Size | Avg Doc | Index Size |
|-----------|----------|-----------|-------------|---------|-----------|
| Group_4_0_0_MemberEvent | 1,000,000 | 342.16MB | 73.58MB | 358 bytes | 71.97MB |
| Group_4_0_0 | 1 | <1KB | 40KB | 863 bytes | 20KB |
| Patient_4_0_0 (test only) | 1,000,000 | 346.93MB | 74.61MB | 363 bytes | 10.53MB |
| **Database total** | | **689.19MB** | **148.29MB** | | **82.57MB** |

> Patient stubs exist only for test reference validation. In production, Patient resources already exist -- the storage cost of this feature is the event collection only.

## Speed Comparison: MongoDB Members vs ClickHouse

All numbers measured on the same machine (MacBook Air, Apple Silicon) using `docker-compose-test.yml` (ephemeral containers, no volumes). Both ClickHouse and MongoDB tests were re-run for this comparison.

- **MongoDB**: 8.0.15 Docker container
- **ClickHouse**: 24.8 Docker container

### Write Speed

| Operation | MongoDB Members | ClickHouse |
|-----------|----------------|------------|
| PATCH 100 ops | 60ms | 74ms |
| PATCH 1K ops | 122ms | 70ms |
| PATCH 5K ops | 252ms | 131ms |
| PATCH 10K ops | 348ms | 182ms |
| 50K via PATCH (5K x 10) | 2.97s | 1.74s |
| PUT with diff (10K, 1K batches) | 5.96s | 5.77s |
| **1M via PATCH (10K x 100)** | **109.72s** | **17.61s** |

MongoDB Members PATCH includes member reference validation (resolving ObjectIds for each referenced resource), which ClickHouse does not perform. This accounts for much of the difference at scale.

Both systems show constant batch times as collection grows:
- MongoDB: 1,043ms - 1,303ms per 10K batch across 100 batches
- ClickHouse: 133ms - 335ms per 10K batch across 100 batches

### Read Speed

| Operation | MongoDB Members | ClickHouse |
|-----------|----------------|------------|
| Member count (10K) | 47ms | 34ms |
| Member count (50K) | 289ms | 53ms |
| **Member count (1M)** | **7,465ms** | **160ms** |
| Member search (100 members) | 233ms | -- |
| Member search (1K members) | 289ms | -- |
| Member search (5K members) | 418ms | -- |

MongoDB view count grows with collection size because it runs a full aggregation pipeline on each query. ClickHouse uses materialized views (AggregatingMergeTree) with pre-computed state, so count performance stays near-constant regardless of scale.

### PATCH Operation Limits

| Operations per PATCH | MongoDB Members | ClickHouse |
|---------------------|----------------|------------|
| 100 | 60ms (200 OK) | 74ms (200 OK) |
| 1,000 | 122ms (200 OK) | 70ms (200 OK) |
| 5,000 | 252ms (200 OK) | 131ms (200 OK) |
| 10,000 | 348ms (200 OK) | 182ms (200 OK) |
| 25,000 | rejected (400) | rejected (400) |
| 50,000 | rejected (400) | rejected (400) |

Both hit the same default 10K operation limit (configurable via `GROUP_PATCH_OPERATIONS_LIMIT`).

### Summary

- **ClickHouse is faster for writes** -- 1M members in 17.6s vs 109.7s (~6x faster), largely because MongoDB Members performs reference validation (ObjectId resolution per member)
- **ClickHouse is significantly faster for reads** -- 1M count in 160ms vs 7,465ms (~47x faster) thanks to materialized views with pre-computed aggregate state
- **Both show zero write degradation** -- constant batch times from batch 1 to batch 100
- **MongoDB Members requires zero additional infrastructure** -- uses existing MongoDB
- **ClickHouse requires a separate cluster** -- additional deployment, monitoring, and backup

**When to use MongoDB Members:**
- Environments without ClickHouse infrastructure
- Simpler operational footprint (single database)
- Groups where read latency of a few seconds is acceptable
- Cost-sensitive deployments (no extra infrastructure)

**When to use ClickHouse:**
- Need for fast member counts and searches at scale (sub-200ms at 1M)
- Environments where ClickHouse is already deployed
- Read-heavy workloads (frequent member searches or counts)
- Groups with 1M+ members that need low-latency queries

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

Both backends can be enabled simultaneously. Per-request routing via header:

```bash
ENABLE_CLICKHOUSE=1
MONGO_WITH_CLICKHOUSE_RESOURCES=Group
ENABLE_MONGO_GROUP_MEMBERS=1
```

- Request WITHOUT `subGroupMemberRequest: true` -> ClickHouse handles members
- Request WITH `subGroupMemberRequest: true` -> MongoDB handles members

## Running Performance Tests

```bash
# Start test MongoDB (ephemeral, no volumes)
docker compose -f docker-compose-test.yml up -d mongo

# Incremental loading (PUT + PATCH patterns, ~60K members)
nvm use && node node_modules/.bin/jest src/tests/performance/group/mongo_member_incremental_loading.test.js

# PATCH operation limits + search performance
nvm use && node node_modules/.bin/jest src/tests/performance/group/mongo_member_patch_performance.test.js

# 1M member loading (100 PATCHes x 10K ops, ~2.5 min)
nvm use && node node_modules/.bin/jest src/tests/performance/group/mongo_member_1m_patch.test.js
```

Tests use `docker-compose-test.yml` (no volume mounts) with an isolated `fhir_perf_test` database, so your main MongoDB data is not affected.
