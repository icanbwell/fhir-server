/**
 * Constants for ClickHouse Group implementation
 *
 * This module centralizes all magic strings and numbers used in the ClickHouse
 * Group member tracking system to improve maintainability and prevent errors.
 */

module.exports = {
    // Table names
    TABLES: {
        GROUP_MEMBER_EVENTS: 'fhir.Group_4_0_0_MemberEvents',
        GROUP_MEMBER_CURRENT: 'fhir.Group_4_0_0_MemberCurrent',
        GROUP_MEMBER_CURRENT_BY_ENTITY: 'fhir.Group_4_0_0_MemberCurrentByEntity',
        AUDIT_EVENT: 'fhir.AuditEvent_4_0_0'
    },

    // Event types for CRUD operations
    OPERATION_TYPES: {
        CREATE: 'C',
        UPDATE: 'U',
        DELETE: 'D'
    },

    // Event types for member lifecycle
    EVENT_TYPES: {
        MEMBER_ADDED: 'added',
        MEMBER_REMOVED: 'removed'
    },

    // Pagination and batch limits
    LIMITS: {
        DEFAULT_PAGE_SIZE: 100,
        MIN_PAGE_SIZE: 1,
        MAX_PAGE_SIZE: 10000,
        MAX_BATCH_SIZE: 50000,
        // Maximum number of JSON Patch operations per PATCH request for Group.member
        // Based on empirical testing (see src/tests/performance/patch_operations_limit.test.js)
        // Kubernetes uses 10K as precedent. Adjust based on actual performance measurements.
        MAX_PATCH_OPERATIONS: 10000
    },

    // Query format for ClickHouse responses
    QUERY_FORMAT: {
        JSON_EACH_ROW: 'JSONEachRow'
    },

    // DateTime conversion patterns
    DATETIME_CONVERSION: {
        // ISO 8601 to ClickHouse DateTime64 format
        // "2024-01-15T10:30:00.000Z" -> "2024-01-15 10:30:00.000"
        ISO_TO_CLICKHOUSE_REPLACEMENTS: [
            { from: /T/g, to: ' ' },
            { from: /Z$/g, to: '' }
        ]
    },

    // Security tag systems (FHIR)
    SECURITY_TAG_SYSTEMS: {
        ACCESS: 'https://www.icanbwell.com/access',
        OWNER: 'https://www.icanbwell.com/owner',
        SOURCE_ASSIGNING_AUTHORITY: 'https://www.icanbwell.com/sourceAssigningAuthority'
    }
};
