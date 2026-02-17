const { EVENT_TYPES } = require('../../constants/clickHouseConstants');

/**
 * Reusable ClickHouse SQL query fragments for Group member queries
 *
 * These fragments ensure consistent query patterns across the codebase
 * and make complex queries easier to understand and maintain.
 */
class QueryFragments {
    /**
     * argMax with tuple tie-breaker for deterministic results
     *
     * When multiple events have the same event_time, the tie-breaker
     * ensures consistent ordering using event_id.
     *
     * @param {string} field - Field to get max value of
     * @param {string} [orderBy='(event_time, event_id)'] - Tuple for ordering
     *
     * @returns {string} SQL fragment
     *
     * @example
     * QueryFragments.argMaxWithTieBreaker('event_type')
     * // Returns: "argMax(event_type, (event_time, event_id))"
     */
    static argMaxWithTieBreaker(field, orderBy = '(event_time, event_id)') {
        return `argMax(${field}, ${orderBy})`;
    }

    /**
     * HAVING clause to filter for active members only
     *
     * Active members are those whose most recent event was 'added'.
     * Removed members are filtered out.
     *
     * @returns {string} SQL HAVING clause
     *
     * @example
     * const query = `SELECT ... HAVING ${QueryFragments.activeMembers()}`;
     */
    static activeMembers() {
        return `${this.argMaxWithTieBreaker('event_type')} = '${EVENT_TYPES.MEMBER_ADDED}'`;
    }

    /**
     * WHERE clause for seeking after a specific reference (cursor pagination)
     *
     * @param {string|null} afterValue - Reference value to seek after
     * @param {string} [column='entity_reference'] - Column name for comparison
     *
     * @returns {string} SQL WHERE clause fragment (may be empty)
     *
     * @example
     * QueryFragments.seekAfter('Patient/100')
     * // Returns: "AND entity_reference > 'Patient/100'"
     *
     * QueryFragments.seekAfter(null)
     * // Returns: ""
     */
    static seekAfter(afterValue, column = 'entity_reference') {
        if (!afterValue) {
            return '';
        }

        // Validate column parameter (allowlist for SQL injection prevention)
        const allowedColumns = ['entity_reference', 'group_id', 'event_time', 'event_id', 'access_tags', 'owner_tags'];
        if (!allowedColumns.includes(column)) {
            throw new Error(`Invalid column name: ${column}`);
        }

        // Use ClickHouse proper escaping: double single quotes (not backslash escaping)
        const escapedValue = afterValue.replace(/'/g, "''");
        return `AND ${column} > '${escapedValue}'`;
    }

    /**
     * Builds a parameterized WHERE clause for seeking (safer than string interpolation)
     *
     * @param {string|null} afterValue - Reference value to seek after
     * @param {string} [column='entity_reference'] - Column name
     *
     * @returns {Object} { clause: string, hasCondition: boolean }
     *
     * @example
     * const { clause, hasCondition } = QueryFragments.seekAfterParameterized('Patient/100');
     * // Returns: { clause: "AND entity_reference > {afterReference:String}", hasCondition: true }
     */
    static seekAfterParameterized(afterValue, column = 'entity_reference') {
        if (!afterValue) {
            return { clause: '', hasCondition: false };
        }

        return {
            clause: `AND ${column} > {afterReference:String}`,
            hasCondition: true
        };
    }

    /**
     * Builds WHERE clause for filtering by Group ID
     *
     * @param {string} groupId - Group UUID
     * @param {boolean} [parameterized=false] - Use parameterized query
     *
     * @returns {string} SQL WHERE clause
     *
     * @example
     * QueryFragments.whereGroupId('550e8400-e29b-41d4-a716-446655440000')
     * // Returns: "WHERE group_id = '550e8400-e29b-41d4-a716-446655440000'"
     *
     * QueryFragments.whereGroupId('...', true)
     * // Returns: "WHERE group_id = {groupId:String}"
     */
    static whereGroupId(groupId, parameterized = false) {
        if (parameterized) {
            return 'WHERE group_id = {groupId:String}';
        }

        // Validate UUID format
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(groupId)) {
            throw new Error('Invalid group ID format. Must be a UUID.');
        }

        // Use ClickHouse proper escaping: double single quotes (not backslash escaping)
        const escapedId = groupId.replace(/'/g, "''");
        return `WHERE group_id = '${escapedId}'`;
    }

    /**
     * Builds WHERE clause for filtering by entity reference
     *
     * @param {string} entityReference - FHIR reference
     * @param {boolean} [parameterized=false] - Use parameterized query
     *
     * @returns {string} SQL WHERE clause
     *
     * @example
     * QueryFragments.whereEntityReference('Patient/123')
     * // Returns: "WHERE entity_reference = 'Patient/123'"
     */
    static whereEntityReference(entityReference, parameterized = false) {
        if (parameterized) {
            return 'WHERE entity_reference = {entityReference:String}';
        }

        // Use ClickHouse proper escaping: double single quotes (not backslash escaping)
        const escapedRef = entityReference.replace(/'/g, "''");
        return `WHERE entity_reference = '${escapedRef}'`;
    }

    /**
     * Builds GROUP BY clause for entity_reference
     *
     * @returns {string} SQL GROUP BY clause
     */
    static groupByEntityReference() {
        return 'GROUP BY entity_reference';
    }

    /**
     * Builds ORDER BY clause for entity_reference
     *
     * @param {string} [direction='ASC'] - Sort direction ('ASC' or 'DESC')
     *
     * @returns {string} SQL ORDER BY clause
     */
    static orderByEntityReference(direction = 'ASC') {
        // Strict allowlist validation to prevent SQL injection
        const allowedDirections = ['ASC', 'DESC'];
        const normalizedDirection = direction.toUpperCase();

        if (!allowedDirections.includes(normalizedDirection)) {
            throw new Error(`Invalid direction. Must be one of: ${allowedDirections.join(', ')}`);
        }

        return `ORDER BY entity_reference ${normalizedDirection}`;
    }

    /**
     * Builds LIMIT clause
     *
     * @param {number} limit - Maximum rows to return
     *
     * @returns {string} SQL LIMIT clause
     */
    static limit(limit) {
        return `LIMIT ${parseInt(limit, 10)}`;
    }

    /**
     * Builds WHERE clause for filtering by access tags (security authorization)
     *
     * This enforces that the user has access to the resource based on meta.security tags.
     * In ClickHouse, these are stored in the access_tags Array(String) column.
     *
     * @param {string[]} accessTags - Array of access tag codes
     * @param {boolean} [parameterized=false] - Use parameterized query
     *
     * @returns {string} SQL WHERE clause fragment
     *
     * @example
     * QueryFragments.whereAccessTags(['client1', 'client2'])
     * // Returns: "AND hasAny(access_tags, ['client1', 'client2'])"
     *
     * QueryFragments.whereAccessTags(['client1'], true)
     * // Returns: "AND hasAny(access_tags, {accessTags:Array(String)})"
     */
    static whereAccessTags(accessTags, parameterized = false) {
        if (!accessTags || accessTags.length === 0) {
            return '';
        }

        if (parameterized) {
            return 'AND hasAny(access_tags, {accessTags:Array(String)})';
        }

        // Build array literal for ClickHouse
        // Use ClickHouse proper escaping: double single quotes (not backslash escaping)
        const tagsList = accessTags.map(tag => `'${tag.replace(/'/g, "''")}'`).join(', ');
        return `AND hasAny(access_tags, [${tagsList}])`;
    }

    /**
     * Builds WHERE clause for filtering by owner tags
     *
     * This enforces that the user is the owner of the resource based on meta.security owner tags.
     * In ClickHouse, these are stored in the owner_tags Array(String) column.
     *
     * @param {string[]} ownerTags - Array of owner tag codes
     * @param {boolean} [parameterized=false] - Use parameterized query
     *
     * @returns {string} SQL WHERE clause fragment
     *
     * @example
     * QueryFragments.whereOwnerTags(['org1'])
     * // Returns: "AND hasAny(owner_tags, ['org1'])"
     */
    static whereOwnerTags(ownerTags, parameterized = false) {
        if (!ownerTags || ownerTags.length === 0) {
            return '';
        }

        if (parameterized) {
            return 'AND hasAny(owner_tags, {ownerTags:Array(String)})';
        }

        // Use ClickHouse proper escaping: double single quotes (not backslash escaping)
        const tagsList = ownerTags.map(tag => `'${tag.replace(/'/g, "''")}'`).join(', ');
        return `AND hasAny(owner_tags, [${tagsList}])`;
    }
}

module.exports = { QueryFragments };
