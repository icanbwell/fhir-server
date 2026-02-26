/**
 * Storage Provider Type Constants
 *
 * Defines the available storage provider architectures.
 * These constants are used throughout the system to avoid magic strings.
 */

/**
 * Storage provider types
 * @readonly
 * @enum {string}
 */
const STORAGE_PROVIDER_TYPES = {
    /**
     * Pure MongoDB storage (default for most FHIR resources)
     * All data stored in MongoDB collections
     */
    MONGO: 'mongo',

    /**
     * MongoDB + ClickHouse dual-write storage
     * - MongoDB: Resource metadata (id, name, type, etc.)
     * - ClickHouse: Event-sourced fields (e.g., Group.member events)
     *
     * Use case: Resources with large arrays that benefit from event sourcing
     * Example: Group (metadata in Mongo, member events in ClickHouse)
     */
    MONGO_WITH_CLICKHOUSE: 'mongo-with-clickhouse',

    /**
     * ClickHouse-only storage (append-only, analytical)
     * All data stored in ClickHouse tables (no MongoDB)
     *
     * Use case: Append-only logs, audit trails, time-series data
     * Example: AuditEvent (immutable audit logs)
     */
    CLICKHOUSE: 'clickhouse'
};

module.exports = { STORAGE_PROVIDER_TYPES };
