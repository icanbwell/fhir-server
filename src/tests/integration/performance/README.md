# Performance Tests

This directory contains performance and scalability tests that are **excluded from coverage runs** to prevent OOM issues with large datasets.

## Test Strategy

### Functional Tests (Included in Coverage)
Run via `npm run test:functional` or `npm run coverage` - excludes this directory

- **Unit tests**: `src/dataLayer/postSaveHandlers/clickHouseGroupHandler.test.js`
- **Integration tests**: `src/tests/group/group_member_lifecycle.test.js`
- **Configuration tests**: `src/tests/group/group_clickhouse_toggle.test.js`
- **Concurrency tests**: `src/tests/group/group_concurrency.test.js`

These validate correctness at reasonable scales (10-1000 members).

### Performance Tests (Excluded from Coverage)
Run via `npm run test:performance` - **only tests in this directory**

Located in `src/tests/performance/group/`:

1. **`member_limits.test.js`** - Progressive scale testing (10 → 10K members)
   - Validates CREATE, GET, and SEARCH operations at increasing scales
   - Identifies performance degradation thresholds
   - Scales: 10, 100, 1K, 10K members

2. **`incremental_loading.test.js`** - FHIR R4B PUT pattern (10K → 50K members)
   - Tests incremental member addition via PUT (full array replacement)
   - Demonstrates proper FHIR R4B compliant pattern
   - Scales: 10K, 50K members

3. **`incremental_loading_1m_patch.test.js`** - Large-scale PATCH (1M members)
   - Tests PATCH scalability at production scale
   - 100 PATCH operations × 10K members each = 1M total
   - Validates performance remains linear at scale
   - **This is the key scalability validation test**

4. **`patch_performance.test.js`** - PATCH operation limits
   - Tests PATCH operation batch sizes: 100, 1K, 5K, 10K, 25K, 50K
   - Finds practical limits for PATCH operations per request
   - Validates recommended batch sizes

## Why Separate Performance Tests?

**Coverage instrumentation + large arrays = heap exhaustion**

- Coverage tools add memory overhead to track code execution
- Large member arrays (100K-1M) cause OOM when combined with coverage
- Performance tests measure real-world behavior, not code coverage
- Solution: Run performance tests separately with high memory allocation

## Running Tests

### Run All Functional Tests with Coverage
```bash
npm run coverage
# Excludes src/tests/performance/ directory
# Generates coverage report in coverage/lcov-report/
```

### Run Only Performance Tests
```bash
npm run test:performance
# Runs with NODE_OPTIONS=--max-old-space-size=40960
# High timeout (600s) for large-scale tests
# Runs in band (sequential) to avoid resource contention
```

### Run Specific Performance Test
```bash
npm test -- --testPathPattern="incremental_loading_1m_patch" --testTimeout=600000
```

## ClickHouse Group Testing Patterns

### Real-World Pattern: Incremental PATCH (Recommended)

For creating Groups with >100K members, use **incremental PATCH operations**:

```bash
# 1. Create empty Group
POST /4_0_0/Group
{
  "id": "large-group",
  "type": "person",
  "actual": true,
  "member": []
}

# 2. Add members incrementally via PATCH (JSON Patch RFC 6902)
PATCH /4_0_0/Group/large-group
Content-Type: application/json-patch+json
[
  { "op": "add", "path": "/member/-", "value": { "entity": { "reference": "Patient/1" } } },
  { "op": "add", "path": "/member/-", "value": { "entity": { "reference": "Patient/2" } } },
  // ... up to 10K-15K operations per PATCH (recommended batch size)
]

# 3. Repeat PATCH operations until target size reached
# For 500K members: 50 PATCH calls × 10K members each
```

**Why PATCH?**
- No read operations (pure append)
- No diff computation
- Direct ClickHouse event writes
- 10-100x faster than PUT for large Groups
- Scales linearly to millions of members

### Alternative: Incremental PUT (FHIR R4B Standard)

```bash
# PUT with full member array (includes all previous + new members)
PUT /4_0_0/Group/large-group
{
  "id": "large-group",
  "type": "person",
  "actual": true,
  "member": [
    { "entity": { "reference": "Patient/1" } },
    { "entity": { "reference": "Patient/2" } },
    // ... all previous members + new ones
  ]
}
```

**Limitations:**
- Requires sending full member array each time
- Array grows with each update (1K → 10K → 100K)
- Memory-intensive for large Groups
- Use PATCH instead for >10K members

### Query Testing (ClickHouse Value Proposition)

ClickHouse's real benefit is **fast member queries**, not bulk creation:

```bash
# Query by member reference (< 100ms even with 1M members)
GET /4_0_0/Group?member.entity._reference=Patient/xyz

# Query by member UUID
GET /4_0_0/Group?member.entity._uuid=abc-123

# These queries hit ClickHouse and return in <100ms regardless of Group size
```

### Why Not Single Large POST?

**HTTP/Express has payload limits (~6MB default)**. Creating Groups with >50K members via single POST will fail with HTTP 413 (Request Entity Too Large).

This is an expected HTTP limitation, not a ClickHouse issue.

**Recommended batch sizes** (from `readme/clickhouse.md`):
- **1K-5K members**: Interactive operations (user-facing APIs)
- **5K-10K members**: Batch operations (background jobs)
- **10K-15K members**: Maximum safe batch size (approaching HTTP limits)

### Production Usage Patterns

Large Groups are created through:
- **Incremental PATCH operations** (10K-15K members per PATCH) ← **Recommended**
- **Admin scripts** using `DatabaseBulkInserter`
- **Batch operations** with `BaseBulkOperationRunner`
- **Gradual accumulation** over time via FHIR operations

## Group DELETE Behavior

**DELETE /Group/{id} removes MongoDB document only**
- ClickHouse event log is preserved as immutable audit trail
- No MEMBER_REMOVED events written on DELETE
- Avoids performance/memory issues with Groups containing millions of members
- Supports historical queries: "which members were in this Group before deletion?"

**Future enhancement:** Kafka event consumer could listen for DELETE events and write MEMBER_REMOVED events asynchronously.

**Individual member removals** (via PATCH/PUT) still write MEMBER_REMOVED events normally.

## ClickHouse Configuration

For local testing:
```bash
# Start ClickHouse
docker-compose up -d clickhouse

# Verify it's running
docker exec fhir-clickhouse clickhouse-client --query "SELECT 1"

# Enable ClickHouse for Groups
export ENABLE_CLICKHOUSE=1
export MONGO_WITH_CLICKHOUSE_RESOURCES=Group
export CLICKHOUSE_WRITE_MODE=sync  # or 'async'
export MAX_GROUP_MEMBERS_PER_PUT=1000000  # Allow large Groups for testing
export PATCH_OPERATIONS_LIMIT=15000  # PATCH batch size limit
```

## Test Results Interpretation

### member_limits.test.js
- **Success**: All operations complete without OOM
- **Failure**: OOM or timeout indicates need for optimization

### incremental_loading.test.js
- **Success**: Linear scaling (time doubles when size doubles)
- **Failure**: Exponential scaling indicates algorithmic issue

### incremental_loading_1m_patch.test.js
- **Success**:
  - Total time < 10 minutes for 1M members
  - Per-PATCH latency < 1s
  - Memory usage stable (no leaks)
  - Query time < 100ms even at 1M members
- **Failure**: Performance degradation or OOM

### patch_performance.test.js
- **Success**: All batch sizes complete in <5s
- **Threshold**: Identifies maximum safe PATCH operation count
- **Failure**: Response times >5s or errors indicate batch size too large

## See Also

- **Architecture**: `readme/clickhouse.md` - Complete ClickHouse integration documentation
- **Functional Tests**: `src/tests/group/` - Integration and lifecycle tests
- **Unit Tests**: `src/dataLayer/postSaveHandlers/clickHouseGroupHandler.test.js`
