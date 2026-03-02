/**
 * Constants for Group resource operations
 *
 * Centralizes magic strings and configuration defaults to improve maintainability
 * and reduce duplication across the codebase.
 */

/**
 * Context keys used for caching and request-scoped data
 */
const CONTEXT_KEYS = {
    /**
     * Generates the context key for storing Group member data
     * @param {string} groupId - The Group resource ID
     * @returns {string} Context key for member data
     */
    GROUP_MEMBERS: (groupId) => `group-members-${groupId}`,

    /**
     * Generates the context key for flagging Group member changes
     * When set to true, forces UPDATE operation even if MongoDB sees no changes
     * (necessary for mongo-with-clickhouse storage where members are in ClickHouse, not MongoDB)
     * @param {string} groupId - The Group resource ID
     * @returns {string} Context key for change flag
     */
    GROUP_MEMBERS_CHANGED: (groupId) => `group-members-changed-${groupId}`,

    /**
     * Generates the context key for indicating member events were already written
     * Used by PATCH operations that write events directly to ClickHouse
     * When set to true, post-save handler skips member event processing
     * @param {string} groupId - The Group resource ID
     * @returns {string} Context key for events written flag
     */
    GROUP_MEMBER_EVENTS_WRITTEN: (groupId) => `group-member-events-written-${groupId}`
};

/**
 * Supported JSON Patch operation types for Group members
 */
const PATCH_OPERATIONS = {
    ADD: 'add',
    REMOVE: 'remove'
};

/**
 * JSON Patch operation paths for Group resources
 */
const PATCH_PATHS = {
    /** Path prefix for member operations */
    MEMBER_PREFIX: '/member',
    /** Path for appending to member array */
    MEMBER_APPEND: '/member/-'
};

/**
 * Default ClickHouse configuration values
 *
 * These are used as fallbacks when environment variables are not set.
 * WARNING: Empty password is for local development only.
 * In production, set CLICKHOUSE_PASSWORD environment variable.
 */
const DEFAULT_CLICKHOUSE = {
    HOST: '127.0.0.1',
    PORT: 8123,
    DATABASE: 'fhir',
    USERNAME: 'default',
    // WARNING: Empty password is insecure. For production, override via CLICKHOUSE_PASSWORD env var.
    PASSWORD: '',
    REQUEST_TIMEOUT_MS: 180000, // 3 minutes
    MAX_CONNECTIONS: 10
};

module.exports = {
    CONTEXT_KEYS,
    PATCH_OPERATIONS,
    PATCH_PATHS,
    DEFAULT_CLICKHOUSE
};
