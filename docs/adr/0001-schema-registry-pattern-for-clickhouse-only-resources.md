# Schema Registry Pattern for ClickHouse-Only Resources

## Status

Implementing (EA-2193)

**Scope notes:**
- Scaffolding implements MergeTree engine only. ReplacingMergeTree support (needed by Observation for at-least-once delivery dedup) ships with the Observation PR.
- `writeStrategy` names a capability, not an implementation. Concrete implementations live in the executor layer and are selected by DI container wiring.
- DCON-3409 implemented AuditEvent ClickHouse writes as a bespoke side-channel. EA-2202 tracks migrating AuditEvent to the generic scaffolding.

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

## Related Decisions

- EA-2202: Migration of AuditEvent from bespoke ClickHouse path to generic scaffolding
- [Future] ReplacingMergeTree support for Observation (deterministic IDs + dedup)
- [Future] ClickHouse cluster configuration and high availability
- [Future] TTL policies for audit log retention

---

**Date**: 2026-03-05
**Authors**: Bill Field
**Status**: Proposed (awaiting implementation)
