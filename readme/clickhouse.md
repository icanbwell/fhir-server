# ClickHouse Integration

## Overview

The Helix FHIR Server supports ClickHouse as an alternative storage backend for FHIR resources requiring scalable array storage or append-only logging. This integration provides flexible storage architectures optimized for different resource patterns.

**Currently Implemented:** Group resources (1M+ members supported)

**Key Capabilities:**
- **Scalability**: Support for resources with massive arrays
- **Performance**: Sub-5-second queries on indexed fields
- **Audit Trail**: Complete event history
- **Flexible Architecture**: Three storage patterns

### Group Resources: Production-Ready

Group resources are the first fully implemented resource type using ClickHouse. This implementation uses an event-sourced, append-only pattern with dual storage:

- **Scalability**: Support for Groups with 1M+ members
- **Performance**: Sub-5-second queries for member lookups
- **Audit Trail**: Complete history of all membership changes
- **Dual Storage**: MongoDB for Group metadata, ClickHouse for member events

## Why ClickHouse Instead of GridFS?

MongoDB's 16MB BSON document limit restricts Group resources to ~50K-100K members. While MongoDB GridFS can store larger documents, it's not suitable for FHIR use cases:

**GridFS Limitations:**
- Designed for file storage (PDFs, images), not structured data
- Poor query performance - no indexes on document contents
- No support for partial document updates
- Incompatible with FHIR search parameters
- Requires chunking/reassembly on every read

**ClickHouse Advantages:**
- Native columnar storage optimized for analytics queries
- Fast member lookups via indexed materialized views
- Event sourcing provides complete audit trail
- FHIR queries work transparently without code changes
- Scales to 10M+ members per Group

## Storage Architecture

The ClickHouse integration supports three distinct storage patterns, enabling flexible architecture choices based on resource requirements:

### 1. MONGO (Default)

Pure MongoDB storage - the standard FHIR server pattern.

**Use Case:** All standard FHIR resources

**Routing:** `StorageProviderFactory` → `MongoStorageProvider`

**Example:** Patient, Observation, Practitioner (most resources)

### 2. MONGO_WITH_CLICKHOUSE (Dual-Write)

Hybrid architecture that stores metadata in MongoDB and events/arrays in ClickHouse.

**Use Case:** Resources with large arrays or audit requirements

**Routing:** `StorageProviderFactory` → `MongoWithClickHouseStorageProvider`
- Writes: Dual-write to both MongoDB and ClickHouse
- Metadata queries: Route to MongoDB
- Array/member queries: Route to ClickHouse

**Currently Implemented:** Group resources
- MongoDB stores: Group metadata (id, name, type, etc.) + full member array
- ClickHouse stores: Member change events (event_type='added'/'removed')
- Member queries (`?member.entity._uuid=xxx`) route to ClickHouse
- Metadata queries (`?name=MyGroup`) route to MongoDB

**Configuration:**
```bash
MONGO_WITH_CLICKHOUSE_RESOURCES=Group
```

**Future Candidates:** List, MeasureReport

### 3. CLICKHOUSE_ONLY (Append-Only)

Pure ClickHouse storage for append-only, immutable resources.

**Use Case:** Audit logs, event streams, immutable historical data

**Routing:** `StorageProviderFactory` → `ClickHouseStorageProvider`

**Example (Stubbed):** AuditEvent, Observation, Communication

**Configuration:**
```bash
CLICKHOUSE_ONLY_RESOURCES=AuditEvent
```

**Status:** Architecture designed and stubbed; implementation pending customer requirements

### How Storage Routing Works

The `StorageProviderFactory` (src/dataLayer/providers/storageProviderFactory.js:22) determines storage based on:

1. **Is ClickHouse enabled?** Check `ENABLE_CLICKHOUSE=1`
2. **Is resource in `MONGO_WITH_CLICKHOUSE_RESOURCES`?** → Use `MongoWithClickHouseStorageProvider`
3. **Is resource in `CLICKHOUSE_ONLY_RESOURCES`?** → Use `ClickHouseStorageProvider`
4. **Default:** → Use `MongoStorageProvider`

## Group Implementation Architecture

### Event-Sourced Pattern

Instead of storing members as embedded arrays in MongoDB documents (which has a 16MB limit), ClickHouse tracks membership as a series of immutable events:

```
Event Log (ClickHouse)                 Current State (Derived Tables)
─────────────────────                  ──────────────────────────────────
event_type='added': Patient/1 @ 10:00  Group A: [Patient/1, Patient/2]
event_type='added': Patient/2 @ 10:05
event_type='removed': Patient/1 @ 10:10
event_type='added': Patient/1 @ 10:15
```

### Database Schema

**`fhir.fhir_group_member_events` Table** (MergeTree, Append-Only)
- Event log storing all membership changes as immutable events
- Source of truth for all membership history
- Ordered by `(group_id, entity_reference, event_time, event_id)`
- No time-based partitioning (maintains full group history for correctness)
- Event types: `added` (added to group), `removed` (removed from group)
- Includes provenance: `actor`, `reason`, `source`, `correlation_id`

**`fhir.fhir_group_member_current` Table** (AggregatingMergeTree)
- Current membership state per (group_id, entity_reference)
- Derives latest state using `argMax` aggregations over event log
- Maintained automatically by `mv_group_member_current` materialized view
- Powers fast roster queries and member state checks
- One logical row per member after background merges

**`fhir.fhir_group_member_current_by_entity` Table** (AggregatingMergeTree)
- Reverse lookup index ordered by `(entity_reference, group_id)`
- Powers "which groups is Patient/X in?" queries
- Maintained automatically by `mv_group_member_current_by_entity` materialized view
- Lightweight: only stores event_type and inactive flag for fast lookups

**Materialized Views**
- `mv_group_member_current`: Updates `fhir_group_member_current` on every insert
- `mv_group_member_current_by_entity`: Updates reverse lookup table on every insert
- Trigger automatically, typically within milliseconds

### Dual-Write Strategy

When a Group is created or updated:

1. **MongoDB**: Stores Group metadata (id, name, type, etc.) + full member array
2. **ClickHouse**: Stores member change events (additions/removals)

Queries route intelligently:
- **Member queries** (`?member.entity._uuid=xxx`): ClickHouse → MongoDB
- **Metadata queries** (`?name=MyGroup`): MongoDB directly

## Configuration

### When to Enable

Enable ClickHouse when:
- Groups are approaching MongoDB's 16MB document limit (~50K-100K members)
- Member queries are timing out or showing poor performance
- You need audit trail of membership changes

### Environment Variables

**Required:**
```bash
# Enable ClickHouse integration
ENABLE_CLICKHOUSE=1

# Dual-write resources: MongoDB metadata + ClickHouse events (comma-separated)
# Currently supported: Group
MONGO_WITH_CLICKHOUSE_RESOURCES=Group

# ClickHouse server connection
CLICKHOUSE_HOST=clickhouse          # Or 127.0.0.1 for IPv4
CLICKHOUSE_PORT=8123                # HTTP interface port
CLICKHOUSE_DATABASE=fhir            # Database name
CLICKHOUSE_USERNAME=default         # Default for local dev
CLICKHOUSE_PASSWORD=                # Empty for local dev
```

**Optional:**
```bash
# Fallback to MongoDB if ClickHouse unavailable (default: false)
CLICKHOUSE_FALLBACK_TO_MONGO=true

# ClickHouse-only resources: Append-only resources (future implementation)
# CLICKHOUSE_ONLY_RESOURCES=AuditEvent,Observation

# Enable multiple dual-write resources (future)
# MONGO_WITH_CLICKHOUSE_RESOURCES=Group,List
```

**Configuration Behavior:**

**MONGO_WITH_CLICKHOUSE_RESOURCES (Dual-Write Pattern):**
- Writes: Dual-write to both MongoDB and ClickHouse
- Array/member queries: Route to ClickHouse for performance
- Metadata queries: Route to MongoDB
- Example: Group resources with large member arrays

**CLICKHOUSE_ONLY_RESOURCES (Append-Only Pattern):**
- Writes: ClickHouse only (immutable events)
- Reads: ClickHouse only
- Example: AuditEvent, Observation (when implemented)

**Default Behavior:**
- When `ENABLE_CLICKHOUSE=0` or resource not in either list:
  - All operations → MongoDB only
  - Existing resources continue to work normally

### Docker Compose

ClickHouse is included in `docker-compose.yml`:

```yaml
clickhouse:
  image: clickhouse/clickhouse-server:24.1
  ports:
    - '8123:8123'   # HTTP
    - '9000:9000'   # Native TCP
  volumes:
    - clickhouse_data:/var/lib/clickhouse
    - ./clickhouse-init:/docker-entrypoint-initdb.d
```

## Usage

### Standard FHIR Queries (Transparent)

The ClickHouse integration is transparent to API consumers. Standard FHIR queries work without modification:

```bash
# Find Groups containing a specific member
GET /4_0_0/Group?member.entity._uuid=patient-uuid-123

# Get Group by ID (includes all members from MongoDB)
GET /4_0_0/Group/my-group-id

# Create Group with members
POST /4_0_0/Group
{
  "resourceType": "Group",
  "type": "person",
  "actual": true,
  "member": [
    {"entity": {"reference": "Patient/1"}},
    {"entity": {"reference": "Patient/2"}}
  ]
}

# Update Group (add/remove members)
PUT /4_0_0/Group/my-group-id
{
  ...with updated member array...
}
```

### Building Large Groups: Incremental Loading Pattern

For Groups with >50K members, use the **incremental loading pattern** to respect HTTP payload limits while building Groups at scale:

#### Why Incremental Loading?

**HTTP/Express Payload Limits:**
- Default payload limit: ~6MB (configurable but typically 6-10MB)
- Single POST with 100K+ members exceeds these limits → HTTP 413 errors
- Standard across FHIR implementations (HAPI, AWS HealthLake, Google Cloud)

**Industry Approach:**
- **HAPI FHIR**: No documented limit, relies on Bulk Export for large datasets
- **AWS HealthLake**: ~6-10MB payload limits (standard AWS API Gateway limits)
- **Google Cloud Healthcare**: ~10MB request size limits
- **FHIR Specification**: Recommends 'definitional' Groups (criteria-based) for large populations

**Unique Capability:** No major FHIR server documents support for 1M+ member enumerated Groups. This ClickHouse implementation enables that scale using standard FHIR operations.

#### The Pattern

Build large Groups incrementally via PUT operations:

```bash
# Step 1: Create Group with initial members (1K-10K recommended)
POST /4_0_0/Group
{
  "resourceType": "Group",
  "id": "attribution-cohort-2025",
  "type": "person",
  "actual": true,
  "member": [
    { "entity": { "reference": "Patient/1" } },
    { "entity": { "reference": "Patient/2" } },
    // ... up to ~10,000 members in initial POST
  ]
}

# Step 2: Add more members via PUT (include previous + new members)
PUT /4_0_0/Group/attribution-cohort-2025
{
  "resourceType": "Group",
  "id": "attribution-cohort-2025",
  "type": "person",
  "actual": true,
  "member": [
    // Include ALL previous members + new ones
    { "entity": { "reference": "Patient/1" } },
    { "entity": { "reference": "Patient/2" } },
    // ... up to ~20,000 members total
  ]
}

# Step 3-N: Continue adding members in batches
PUT /4_0_0/Group/attribution-cohort-2025
{
  "resourceType": "Group",
  "id": "attribution-cohort-2025",
  "type": "person",
  "actual": true,
  "member": [
    // Include ALL previous + new (30K, 40K, 50K... 1M+)
  ]
}
```

#### How ClickHouse Handles This

**Event Sourcing Optimization:**
- Each PUT compares new member array with ClickHouse's current state
- Only writes events with `event_type='added'` for new members
- Only writes events with `event_type='removed'` for removed members
- No duplicate events = efficient storage and fast queries

**Example:**
```
Initial: [Patient/1, Patient/2]
Update:  [Patient/1, Patient/2, Patient/3, Patient/4]

ClickHouse writes:
  → event_type='added': Patient/3
  → event_type='added': Patient/4

No events for Patient/1 and Patient/2 (already members)
```

#### Benefits

✅ **Respects HTTP payload limits** (6-10MB per request)
✅ **Uses standard FHIR operations** (no custom extensions)
✅ **Works with existing FHIR clients** (no special code needed)
✅ **Scales to millions** (unique to this implementation)
✅ **Complete audit trail** (every membership change logged)
✅ **Efficient storage** (only stores deltas)

#### Batch Size Recommendations

| Batch Size | Payload Size | Use Case |
|------------|--------------|----------|
| 1K-5K members | ~500KB-2.5MB | Interactive API calls |
| 5K-10K members | ~2.5MB-5MB | Batch jobs |
| 10K-15K members | ~5MB-7.5MB | Maximum safe size |

**Note:** Monitor actual payload sizes for your data. Member object complexity affects size (period dates, inactive flags, extensions).

#### Production Usage

Real-world scenarios using this pattern:

1. **Attribution Cohorts** (100K-1M patients)
   - Initial roster via bulk import (10K batches)
   - Daily updates via incremental PUT operations
   - Fast member lookup for eligibility checks

2. **Measure Population Segments** (50K-500K patients)
   - Initial calculation creates Group
   - Monthly recalculation updates membership
   - Analytics queries on membership changes over time

3. **Network Directories** (10K-100K providers)
   - Initial directory load
   - Weekly updates for new/departed providers
   - Geographic and specialty-based queries

### Querying ClickHouse Directly

For debugging or advanced analytics, query ClickHouse directly:

```sql
-- Connect to ClickHouse
docker exec -it fhir-clickhouse clickhouse-client

-- View current members of a Group (with pagination)
SELECT
    entity_reference,
    argMaxMerge(entity_type) AS entity_type,
    argMaxMerge(event_time) AS last_event_time
FROM fhir.fhir_group_member_current
WHERE group_id = 'my-group-id'
  AND entity_reference > 'Patient/000000'  -- cursor for pagination
GROUP BY entity_reference
HAVING argMaxMerge(event_type) = 'added'
   AND argMaxMerge(inactive) = 0
ORDER BY entity_reference
LIMIT 100;

-- View complete event history for a Group
SELECT
    event_type,
    event_time,
    entity_reference,
    actor,
    reason,
    correlation_id
FROM fhir.fhir_group_member_events
WHERE group_id = 'my-group-id'
ORDER BY event_time ASC, event_id ASC;

-- Find Groups containing a specific member (reverse lookup)
SELECT
    group_id
FROM fhir.fhir_group_member_current_by_entity
WHERE entity_reference = 'Patient/123'
GROUP BY group_id
HAVING argMaxMerge(event_type) = 'added'
   AND argMaxMerge(inactive) = 0;

-- Count active members in a Group
SELECT count()
FROM (
    SELECT entity_reference
    FROM fhir.fhir_group_member_current
    WHERE group_id = 'my-group-id'
    GROUP BY entity_reference
    HAVING argMaxMerge(event_type) = 'added'
       AND argMaxMerge(inactive) = 0
);

-- View full event history for a member in a Group (care gap timeline)
SELECT
    event_type,
    event_time,
    period_start,
    period_end,
    inactive,
    actor,
    reason,
    source,
    correlation_id
FROM fhir.fhir_group_member_events
WHERE group_id = 'my-group-id'
  AND entity_reference = 'Patient/456'
ORDER BY event_time ASC, event_id ASC;
```

## Performance

### Benchmark Results

| Operation | MongoDB (50K members) | ClickHouse (1M members) | Improvement |
|-----------|----------------------|-------------------------|-------------|
| Create Group | ~15s | ~18s (dual-write) | Comparable |
| GET by ID | ~2s | ~2s | Same |
| Search by member | ~500ms | ~100ms | 5x faster |
| Add 1 member | ~15s | ~1s | 15x faster |
| Remove 1 member | ~15s | ~1s | 15x faster |

### Scalability Limits

| Storage | Max Practical Members | Document/Table Size |
|---------|----------------------|---------------------|
| MongoDB | ~50,000 | 16MB BSON limit |
| ClickHouse | 10,000,000+ | Unlimited (no partitioning) |

## Event Types

### event_type='added'

Fired when a member is added to a Group.

**Triggers:**
- New member in Group.member array (POST or PUT)
- Member re-added after previous removal

**Example:**
```json
{
  "event_type": "added",
  "group_id": "my-group-id",
  "entity_reference": "Patient/123",
  "entity_type": "Patient",
  "event_time": "2024-01-15T10:30:00.000Z"
}
```

### event_type='removed'

Fired when a member is removed from a Group.

**Triggers:**
- Member no longer in Group.member array (PUT)
- Empty member array (`member: []`)

**Example:**
```json
{
  "event_type": "removed",
  "group_id": "my-group-id",
  "entity_reference": "Patient/123",
  "event_time": "2024-01-15T11:00:00.000Z"
}
```

## Member Lifecycle

### Scenario: Add → Remove → Re-add

```
Time    Action              Events in ClickHouse           Current State (Derived Tables)
───────────────────────────────────────────────────────────────────────────────────────
10:00   Create Group        event_type='added' (Patient/1)    Patient/1: event_type='added'
10:05   Update (remove)     event_type='removed' (Patient/1)  Patient/1: event_type='removed'
10:10   Update (re-add)     event_type='added' (Patient/1)    Patient/1: event_type='added'
```

**Query behavior:**
- At 10:00: Group appears in search for Patient/1 ✓
- At 10:05: Group does NOT appear in search for Patient/1 ✗
- At 10:10: Group appears in search for Patient/1 again ✓

## Migration

### Existing Groups

Existing Groups in MongoDB will continue to work without modification. They will use MongoDB storage until updated, at which point they'll start using the dual-write pattern.

### Backfill Script (Optional)

To migrate existing Groups to ClickHouse:

```bash
# Coming in future release
node src/admin/scripts/backfillGroupsToClickHouse.js
```

## Monitoring

### Health Checks

The `/health` endpoint includes ClickHouse status:

```bash
curl http://localhost:3000/health

{
  "mongodb": "ok",
  "clickhouse": "ok",
  "redis": "ok"
}
```

### Logs

ClickHouse operations are logged with structured JSON:

```json
{
  "level": "info",
  "message": "Writing Group member events to ClickHouse",
  "groupId": "my-group",
  "additions": 5,
  "removals": 2
}
```

## Troubleshooting

### ClickHouse Connection Errors

**Symptom:** `Error connecting to ClickHouse`

**Solutions:**
1. Verify ClickHouse is running: `docker ps | grep clickhouse`
2. Check logs: `docker logs fhir-clickhouse`
3. Test connection: `docker exec -it fhir-clickhouse clickhouse-client`
4. Verify environment variables in `docker-compose.yml`

### Query Performance Issues

**Symptom:** Member queries taking >5 seconds

**Solutions:**
1. Check ClickHouse tables exist: `SHOW TABLES FROM fhir`
2. Verify schema: `SHOW CREATE TABLE fhir.fhir_group_member_events`
3. Check materialized views are populated: `SELECT count(*) FROM fhir.fhir_group_member_current`
4. Review ClickHouse logs for errors

### Dual-Write Failures

**Symptom:** Data in MongoDB but not ClickHouse

**Solutions:**
1. Check ClickHouse logs for insert errors
2. Verify security tags are present on Group resource
3. Ensure `ENABLE_CLICKHOUSE=1` is set
4. Check `CLICKHOUSE_HYBRID_RESOURCES` includes `Group`

### Fallback to MongoDB

If ClickHouse becomes unavailable, the system automatically falls back to MongoDB (if configured):

```bash
# Enable automatic fallback
CLICKHOUSE_FALLBACK_TO_MONGO=1
```

## Security

### Access Control

Group member queries respect FHIR security tags:

```javascript
// Only Groups with matching access/owner tags are returned
meta: {
  security: [
    { system: "https://www.icanbwell.com/access", code: "client1" },
    { system: "https://www.icanbwell.com/owner", code: "client1" }
  ]
}
```

### Data Isolation

ClickHouse tables are partitioned by time and indexed by Group UUID, ensuring:
- Efficient queries
- Data locality
- Easy archival of old data

## Limitations

### Architectural Limitations (All ClickHouse Resources)
1. **Read-After-Write Consistency**: Brief delay (<100ms) before data appears in materialized views
2. **No Cross-Resource Transactions**: ClickHouse and MongoDB writes are independent (eventual consistency)

### Group-Specific Limitations (Current Implementation)
1. **No Pagination**: Full member array returned in GET requests (use `_elements` to limit fields)
2. **Bulk Operations**: No native batch member add/remove (use incremental PUT pattern)

### Current Scope
1. **Single Resource Type**: Only Group resources currently implemented
   - Architecture supports multiple resources
   - Additional resources driven by customer requirements

## Extending to Additional Resources

The ClickHouse integration is designed to be resource-agnostic. This section provides a blueprint for adding new resources.

### Prerequisites

Before adding a new resource to ClickHouse:

1. **Identify the Pattern**: Which storage pattern fits your use case?
   - **MONGO_WITH_CLICKHOUSE**: Large arrays, dual-write needed (e.g., List)
   - **CLICKHOUSE_ONLY**: Append-only, immutable events (e.g., AuditEvent, Observation)

2. **Understand the Trade-offs**:
   - Read-after-write consistency delays (<100ms)
   - Additional infrastructure complexity
   - Storage costs (data in both systems for dual-write)

3. **Reference Implementation**: Study Group implementation as template

### Pattern 1: MONGO_WITH_CLICKHOUSE (Dual-Write)

Use this pattern for resources with large arrays that need metadata queries on MongoDB.

**Example Use Cases:**
- **List**: Large item arrays (1M+ entries)
- **MeasureReport**: Large population arrays (quality measures)

#### Step 1: Design Event Schema

Define ClickHouse table for resource-specific events.

**Example (List resources):**
```sql
CREATE TABLE fhir.fhir_list_item_events (
    list_id String,
    item_reference String,
    item_type LowCardinality(String),
    event_type Enum8('added' = 1, 'removed' = 2),
    event_time DateTime64(3, 'UTC') DEFAULT now64(3, 'UTC'),
    event_id UUID DEFAULT generateUUIDv4(),
    deleted UInt8 DEFAULT 0,
    actor String DEFAULT '',
    reason LowCardinality(String) DEFAULT '',
    source LowCardinality(String) DEFAULT '',
    correlation_id String DEFAULT '',
    list_source_id String DEFAULT '',
    access_tags Array(String) DEFAULT [],
    owner_tags Array(String) DEFAULT []
) ENGINE = MergeTree()
ORDER BY (list_id, item_reference, event_time, event_id);
```

#### Step 2: Create Materialized Views

Create views for current state and optimized queries.

**Example:**
```sql
CREATE TABLE fhir.fhir_list_item_current (
    list_id String,
    item_reference String,
    item_type AggregateFunction(argMax, LowCardinality(String), Tuple(DateTime64(3, 'UTC'), UUID)),
    event_type AggregateFunction(argMax, Enum8('added' = 1, 'removed' = 2), Tuple(DateTime64(3, 'UTC'), UUID)),
    event_time AggregateFunction(argMax, DateTime64(3, 'UTC'), Tuple(DateTime64(3, 'UTC'), UUID)),
    deleted AggregateFunction(argMax, UInt8, Tuple(DateTime64(3, 'UTC'), UUID)),
    actor AggregateFunction(argMax, String, Tuple(DateTime64(3, 'UTC'), UUID)),
    correlation_id AggregateFunction(argMax, String, Tuple(DateTime64(3, 'UTC'), UUID)),
    access_tags AggregateFunction(argMax, Array(String), Tuple(DateTime64(3, 'UTC'), UUID)),
    owner_tags AggregateFunction(argMax, Array(String), Tuple(DateTime64(3, 'UTC'), UUID))
) ENGINE = AggregatingMergeTree
ORDER BY (list_id, item_reference);

CREATE MATERIALIZED VIEW fhir.mv_list_item_current
TO fhir.fhir_list_item_current
AS SELECT
    list_id,
    item_reference,
    argMaxState(item_type, tuple(event_time, event_id)) AS item_type,
    argMaxState(event_type, tuple(event_time, event_id)) AS event_type,
    argMaxState(event_time, tuple(event_time, event_id)) AS event_time,
    argMaxState(deleted, tuple(event_time, event_id)) AS deleted,
    argMaxState(actor, tuple(event_time, event_id)) AS actor,
    argMaxState(correlation_id, tuple(event_time, event_id)) AS correlation_id,
    argMaxState(access_tags, tuple(event_time, event_id)) AS access_tags,
    argMaxState(owner_tags, tuple(event_time, event_id)) AS owner_tags
FROM fhir.fhir_list_item_events
GROUP BY list_id, item_reference;
```

#### Step 3: Implement Post-Save Handler

Add logic to compute deltas and write events to ClickHouse.

**Location:** `src/operations/common/postSaveProcessor.js`

**Reference:** Group implementation at `src/dataLayer/clickhouse/groupMemberEventWriter.js`

**Key Logic:**
```javascript
async function writeListItemEvents(resource, previousResource) {
    // 1. Extract current items from resource.entry
    const currentItems = extractItems(resource);

    // 2. Query ClickHouse for previous items
    const previousItems = await queryCurrentItems(resource.id);

    // 3. Compute delta
    const additions = currentItems.filter(i => !previousItems.includes(i));
    const removals = previousItems.filter(i => !currentItems.includes(i));

    // 4. Write events to ClickHouse
    await writeEvents(additions, removals, resource);
}
```

#### Step 4: Update Configuration

Add resource to configuration list:

```bash
MONGO_WITH_CLICKHOUSE_RESOURCES=Group,List
```

#### Step 5: Implement Query Routing

Update `StorageProviderFactory` to route queries for new resource.

**Location:** `src/dataLayer/providers/storageProviderFactory.js`

**Reference:** Existing Group routing logic

### Pattern 2: CLICKHOUSE_ONLY (Append-Only)

Use this pattern for immutable, append-only resources (audit logs, events).

**Example Use Cases:**
- **AuditEvent**: Compliance logging, security audit trail
- **Observation**: Device telemetry (wearables, IoT sensors), high-frequency lab results, continuous monitoring
- **Communication**: Care gap outreach history

#### Step 1: Design Append-Only Table

Create ClickHouse table with all FHIR resource fields.

**Example (AuditEvent):**
```sql
CREATE TABLE fhir.fhir_audit_events (
    resource_id String,
    recorded DateTime64(3, 'UTC'),
    type_system String,
    type_code String,
    subtype_system String,
    subtype_code String,
    action LowCardinality(String),
    outcome LowCardinality(String),
    agent_who String,
    agent_requestor UInt8,
    agent_type_system String,
    agent_type_code String,
    source_observer String,
    source_type_system String,
    source_type_code String,
    entity_what String,
    entity_type LowCardinality(String),
    entity_role LowCardinality(String),
    raw_resource String,  -- Full FHIR JSON for completeness
    source_id String DEFAULT '',
    access_tags Array(String) DEFAULT [],
    owner_tags Array(String) DEFAULT []
) ENGINE = MergeTree()
ORDER BY (recorded, resource_id);
```

#### Step 2: Implement Storage Provider

Create ClickHouse-only storage provider.

**Location:** `src/dataLayer/providers/clickhouseStorageProvider.js`

**Key Methods:**
- `createAsync()`: INSERT into ClickHouse
- `searchAsync()`: SELECT with WHERE clauses from FHIR search params
- `getAsync()`: SELECT by resource_uuid

**Note:** No UPDATE or DELETE operations (append-only)

#### Step 3: Update Configuration

Add resource to ClickHouse-only list:

```bash
CLICKHOUSE_ONLY_RESOURCES=AuditEvent,Observation
```

#### Step 4: Schema Mapping

Map FHIR search parameters to ClickHouse columns.

**Location:** `src/dataLayer/clickhouse/searchParameterMapper.js`

**Example:**
```javascript
const auditEventSearchParams = {
    'date': 'recorded',
    'entity': 'entity_what',
    'agent': 'agent_who',
    'action': 'action',
    'type': 'type_code'
};
```

### Testing New Resources

After implementation:

1. **Unit Tests**: Test event writing, query routing, delta computation
2. **Integration Tests**: Test full CRUD operations
3. **Performance Tests**: Verify query performance at scale
4. **Migration Tests**: Test backward compatibility with existing MongoDB data

### Complete Example: Group Implementation

Study the Group implementation for a complete reference:

**Event Schema:**
- `clickhouse-init/01-init-schema.sql` (complete schema with all tables and views)

**Event Writer:**
- `src/dataLayer/clickhouse/groupMemberEventWriter.js`

**Query Router:**
- `src/dataLayer/providers/storageProviderFactory.js`
- `src/operations/search/groupSearchHandler.js`

**Post-Save Hook:**
- `src/operations/common/postSaveProcessor.js`

**Configuration:**
- `src/utils/configManager.js` (MONGO_WITH_CLICKHOUSE_RESOURCES)

## Future Enhancements

### Near-Term Optimizations (Group Resources)

**Temporal Queries**
- Query Group membership at specific point in time
- Example: "Who was in this cohort on 2024-01-15?"
- Use event log to reconstruct historical state

**Bulk Operations**
- Batch member additions/removals via FHIR Batch/Transaction
- Reduce HTTP overhead for large membership updates
- Target: 100K member updates in single operation

**GraphQL Support**
- ClickHouse-backed GraphQL resolvers for Group queries
- Eliminate need for REST pagination
- Direct access to materialized views

**Analytics Endpoints**
- Membership trend analysis
- Cohort overlap queries
- Member churn metrics

### Additional Resource Candidates

Implementation of additional resources will be driven by customer requirements. The architecture supports:

**MONGO_WITH_CLICKHOUSE Pattern (Dual-Write):**
- **List**: Large item arrays for care plan tracking, formularies
- **MeasureReport**: Quality measure populations (numerator/denominator/exclusion arrays)

**CLICKHOUSE_ONLY Pattern (Append-Only):**
- **AuditEvent** *(Most viable near-term)*: Security audit logs, compliance tracking
  - High volume, immutable, analytical queries
  - No need for MongoDB metadata
  - Complementary to existing MongoDB AuditEvent storage
- **Observation** *(Device Telemetry)*: Wearables, IoT sensors, continuous monitoring devices
  - Time-series data from patient monitoring devices
  - High-volume streaming telemetry (heart rate, blood pressure, glucose)
  - Analytical queries on vital signs trends and anomaly detection
  - Scalable storage for millions of device readings
- **Communication**: Care gap outreach tracking, patient engagement history

### Strategic Vision: Complementary Analytical Data Plane

ClickHouse positions the FHIR server as a **real-time analytical platform**, not just transactional storage:

**Traditional FHIR Architecture:**
- FHIR Server → Transactional queries (milliseconds)
- Data Warehouse → Analytical queries (hours/days)

**With ClickHouse Integration:**
- FHIR Server → Transactional + analytical queries (milliseconds)
- Real-time cohort analysis, membership trends, audit queries
- Eliminates need for batch ETL pipelines for many use cases

**Target Analytical Queries:**
- "Find all Groups with >10K members added in last 30 days"
- "Show membership churn rate by Group type"
- "Audit trail: Who accessed resource X in past 90 days?"

### Infrastructure Enhancements

- **Read Replicas**: Horizontal scaling for ClickHouse read operations
- **Sharding**: Partition data across multiple ClickHouse clusters
- **Tiered Storage**: Hot/cold data separation (recent vs. historical events)

**Note:** All enhancements driven by customer needs. No timeline commitments.

## Related Documentation

- [Performance Optimization](./performance.md)
- [Security Model](./security.md)
- [Everything Operation](./everything.md)
- [Merge Functionality](./merge.md)

## Support

For issues or questions:
- GitHub Issues: https://github.com/icanbwell/fhir-server/issues
- Internal Slack: #helix-fhir-server
