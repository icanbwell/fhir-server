# Schema Registry Pattern for ClickHouse-Only Resources

## Status

Implemented

**Scope notes:**
- Scaffolding supports both MergeTree and ReplacingMergeTree engines. Observation uses ReplacingMergeTree for at-least-once delivery dedup.
- `writeStrategy` names a capability, not an implementation. Concrete implementations live in the executor layer and are selected by DI container wiring.
- A bespoke AuditEvent ClickHouse write path exists separately. A follow-on ticket tracks migrating it to the generic scaffolding.

## Context

We are implementing ClickHouse-only storage mode for append-only FHIR resources, starting with AuditEvent. The existing codebase has:

- **MongoDB storage**: Generic infrastructure using `DatabaseQueryFactory.createQuery({ resourceType })` that works for all 150+ FHIR resource types without resource-specific repository classes
- **Group ClickHouse integration**: MongoDB + ClickHouse dual-write with resource-specific implementations (`GroupMemberRepository`, `GroupMemberEventBuilder`, `ClickHouseGroupHandler`)

### Problem

We need to decide on the abstraction pattern for ClickHouse-only resources:

**Do we create resource-specific classes for each ClickHouse resource?**
- `AuditEventRepository`, `MetricRepository`, `ProvenanceRepository`, etc.
- 150+ potential concrete implementations

**Or do we use a generic pattern like MongoDB does?**
- Configuration-driven approach
- Single generic repository implementation

### Requirements

1. Support multiple ClickHouse-only resource types (starting with AuditEvent)
2. Each resource may have different:
   - Table schema (optimized for its search parameters)
   - Required filters (e.g., AuditEvent requires date range)
   - Searchable fields (agent, entity, type, etc.)
3. Minimize code duplication
4. Match the mental model of existing MongoDB infrastructure
5. Easy to add new resources without major code changes

## Decision

**We will use the Schema Registry + Generic Repository pattern.**

### Architecture

```javascript
// Configuration-driven schema registry
const RESOURCE_SCHEMAS = {
    AuditEvent: {
        tableName: 'fhir.fhir_audit_events',
        sortKey: 'recorded',
        searchableFields: {
            'date': { column: 'recorded', type: 'datetime' },
            'type': { column: 'type_code', type: 'string' },
            'agent': { column: 'agent_references', type: 'array' }
        },
        requiredFilters: ['date'],
        maxRangeDays: 30,
        extractFields: (resource) => ({ /* FHIR → ClickHouse row */ })
    }
    // Future resources just add configuration here
};

// Generic repository - works for all ClickHouse-only resources
class GenericClickHouseRepository {
    async searchAsync({ resourceType, query, options }) {
        const schema = ClickHouseSchemaRegistry.getSchema(resourceType);
        const whereClause = this.queryBuilder.buildWhere(query, schema);
        // Execute generic query using schema configuration
    }
}
```

### Key Components

1. **Schema Registry** (`src/dataLayer/clickHouse/schemaRegistry.js`)
   - Defines resource-specific behavior via configuration
   - Maps FHIR search parameters to ClickHouse columns
   - Specifies required filters and validation rules
   - Provides field extraction logic

2. **Generic Repository** (`src/dataLayer/repositories/genericClickHouseRepository.js`)
   - Single implementation for all ClickHouse-only resources
   - Uses schema configuration to drive behavior
   - Handles search, findById, count, insert operations

3. **Generic Query Builder** (`src/dataLayer/builders/genericClickHouseQueryBuilder.js`)
   - Dynamically builds WHERE clauses from FHIR search parameters
   - Uses schema.searchableFields to map parameters to columns
   - Supports datetime ranges, string equality, array searching

4. **Resource-Specific Tables**
   - Each resource gets its own optimized ClickHouse table
   - Schema designed for resource-specific search patterns
   - Example: `fhir.fhir_audit_events` partitioned by month for time-series queries

### Adding a New Resource

To add a new ClickHouse-only resource:

1. Create ClickHouse table schema (SQL)
2. Add configuration to `RESOURCE_SCHEMAS` in `schemaRegistry.js`
3. Set `CLICKHOUSE_ONLY_RESOURCES=ResourceType` environment variable

**No new classes required.**

## Consequences

### Positive

1. **Zero Code Duplication**: One repository implementation serves all ClickHouse-only resources
2. **Consistent Mental Model**: Matches MongoDB's generic `createQuery({ resourceType })` pattern
3. **Easy Extension**: Adding new resources is configuration only (5-10 lines)
4. **Maintainability**: Bug fixes and improvements benefit all resources
5. **Type Safety**: Schema configuration can be TypeScript-validated
6. **Performance**: Resource-specific tables allow optimization per resource's query patterns
7. **Testability**: Generic code is tested once; configuration is declarative

### Negative

1. **Initial Complexity**: More upfront design compared to simple resource-specific classes
2. **Schema Evolution**: Changes to generic code affect all resources (requires careful testing)
3. **Debugging**: Generic code can be harder to debug than concrete implementations
4. **Configuration Validation**: Need runtime validation that schema configurations are correct

### Mitigations

- Comprehensive unit tests for generic repository and query builder
- Schema validation on application startup
- Clear documentation with examples for adding new resources
- TypeScript types for schema configuration structure

## Options Considered

### Option 1: Resource-Specific Repository Classes (Rejected)

```javascript
class AuditEventRepository { /* ... */ }
class MetricRepository { /* ... */ }
class ProvenanceRepository { /* ... */ }
```

**Pros:**
- Simple and direct
- Easy to understand for specific resource
- Type-safe per resource

**Cons:**
- Code duplication across 150+ potential resources
- Inconsistent with MongoDB approach
- Every new resource requires new class
- Bug fixes must be replicated across all classes
- Maintenance burden scales with number of resources

**Rejection Reason**: Does not match existing MongoDB pattern and creates massive code duplication.

### Option 2: Single Generic Table for All Resources (Rejected)

```sql
CREATE TABLE fhir.fhir_resources (
    id String,
    resource_type String,
    resource_json String,
    timestamp DateTime64(3)
);
```

**Pros:**
- Simplest schema
- One table for everything
- Easy to implement

**Cons:**
- Cannot optimize for resource-specific search patterns
- Poor query performance (no resource-specific indexes)
- Partitioning strategy cannot be resource-specific
- Loses benefits of ClickHouse's columnar storage

**Rejection Reason**: Sacrifices query performance and optimization capabilities.

### Option 3: Hybrid - Resource-Specific Tables + Generic Code (Selected)

**Pros:**
- Optimized tables per resource (performance)
- Generic code (no duplication)
- Flexible partitioning strategies per resource
- Resource-specific indexes and sort keys
- Configuration-driven (easy to extend)

**Cons:**
- More upfront design work
- Generic code must handle various field types

**Selection Reason**: Best balance of performance, maintainability, and extensibility.

## References

- FHIR R4 Specification: https://hl7.org/fhir/R4/
- ClickHouse Best Practices: https://clickhouse.com/docs/en/guides/best-practices
- Existing Group ClickHouse Integration: `src/dataLayer/postSaveHandlers/clickHouseGroupHandler.js`
- MongoDB Generic Pattern: `src/dataLayer/databaseQueryFactory.js`

## ReplacingMergeTree and Observation

### Engine choice

Observation uses `ReplacingMergeTree(meta_version_id)` because wearable device telemetry has at-least-once delivery semantics. Duplicate readings with the same logical identity (subject, code, effective datetime) are collapsed at query time using the highest `meta_version_id`.

### LIMIT 1 BY, not FINAL

Read-path dedup uses `LIMIT 1 BY` on the schema's dedupKey, not `FINAL`:

- **FINAL** merges parts at query time. Cost scales with part count and insert burst patterns. Wearable telemetry has sync-after-offline bursts that spike part counts, causing latency to jump by an order of magnitude during exactly the times the read path needs to be fast.
- **LIMIT 1 BY** makes dedup explicit in the SQL. It is debuggable, forces the dedupKey to be correct, and is the standard ClickHouse pattern for reading from ReplacingMergeTree without FINAL's cost.

The query builder wraps ReplacingMergeTree search/count queries in a subquery:

```sql
SELECT _fhir_resource
FROM (
    SELECT *
    FROM fhir.Observation_4_0_0
    WHERE <filters> AND <security>
    ORDER BY subject_reference, code_code, effective_datetime, meta_version_id DESC
    LIMIT 1 BY subject_reference, code_code, effective_datetime
)
WHERE <seek-pagination-clause>
ORDER BY subject_reference, code_code, effective_datetime, id
LIMIT {_limit:UInt32}
```

`findById` uses `ORDER BY meta_version_id DESC LIMIT 1` directly (no subquery needed since id uniquely identifies a logical row).

MergeTree queries are unchanged — no subquery, no LIMIT 1 BY.

### meta.versionId contract

`meta_version_id` (UInt64) is parsed from `meta.versionId`. The FHIR server always sets `meta.versionId` on create and update. If absent, defaults to 0 — two version-less inserts collapse arbitrarily, which is correct for identical readings. `meta.versionId` should be deterministic per logical reading and not increment on retry.

### FHIR resource storage

Observation stores `_fhir_resource` as a `String CODEC(ZSTD(3))` column, not native ClickHouse JSON. Dedicated search columns (code_code, subject_reference, effective_datetime, etc.) handle filtering. The full FHIR resource is only deserialized for response reconstruction. ZSTD-compressed strings provide better compression for heterogeneous FHIR payloads than ClickHouse's native JSON type.

## Related Decisions

- Migration of AuditEvent from bespoke ClickHouse path to generic scaffolding
- ClickHouse cluster configuration and high availability
- TTL policies for audit log retention

---

**Date**: 2026-03-05
**Authors**: Bill Field
**Status**: Implemented
