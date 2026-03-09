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
    GROUP_MEMBERS_CHANGED: (groupId) => `group-members-changed-${groupId}`
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
 *
 * CONNECTION POOL SIZING:
 * - Default: 100 connections per pod (matches MongoDB's maxPoolSize pattern)
 * - Configurable via CLICKHOUSE_MAX_CONNECTIONS env var
 * - PRODUCTION REQUIREMENT: ClickHouse server must be configured with:
 *   max_connections >= (pod_count × max_pool_size × 1.25)
 *   Example: 100 pods × 100 connections × 1.25 = 12,500 minimum
 * - ClickHouse default max_connections = 4096 (too low for production scale)
 * - Configure in ClickHouse config.xml: <max_connections>15000</max_connections>
 */
const DEFAULT_CLICKHOUSE = {
    HOST: '127.0.0.1',
    PORT: 8123,
    DATABASE: 'fhir',
    USERNAME: 'default',
    PASSWORD: '',
    REQUEST_TIMEOUT_MS: 180000, // 3 minutes
    MAX_CONNECTIONS: 100 // Matches MongoDB pattern; see CONNECTION POOL SIZING above
};

module.exports = {
    CONTEXT_KEYS,
    PATCH_OPERATIONS,
    PATCH_PATHS,
    DEFAULT_CLICKHOUSE
};
