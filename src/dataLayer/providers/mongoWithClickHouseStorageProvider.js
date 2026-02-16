const { StorageProvider } = require('./storageProvider');
const { logDebug, logInfo, logError, logWarn } = require('../../operations/common/logging');
const { RethrownError } = require('../../utils/rethrownError');
const { TABLES, EVENT_TYPES } = require('../../constants/clickHouseConstants');
const { QueryFragments } = require('../../utils/clickHouse/queryFragments');
const { STORAGE_PROVIDER_TYPES } = require('./storageProviderTypes');

/**
 * MongoDB + ClickHouse Storage Provider for resources with dual-write storage
 *
 * Handles resources stored in BOTH MongoDB AND ClickHouse:
 * - MongoDB: Resource metadata (always)
 * - ClickHouse: Event-sourced fields (e.g., Group.member)
 *
 * Current use case: Group resources
 * - MongoDB stores: id, name, type, actual, meta, etc.
 * - ClickHouse stores: member addition/removal events
 *
 * Architecture: Materialized views over append-only event log
 * - Uses materialized views (mv_group_member_current_by_entity) for aggregated state
 * - All queries use FINAL modifier to force MV sync (ensures read-after-write consistency)
 * - Tuple tie-breaker (event_time, event_id) for deterministic argMax
 * - Seek pagination for efficient large result sets
 */
class MongoWithClickHouseStorageProvider extends StorageProvider {
    /**
     * @param {Object} params
     * @param {import('../../operations/common/resourceLocator').ResourceLocator} params.resourceLocator
     * @param {import('../../utils/clickHouseClientManager').ClickHouseClientManager} params.clickHouseClientManager
     * @param {import('./mongoStorageProvider').MongoStorageProvider} params.mongoStorageProvider
     * @param {import('../../utils/configManager').ConfigManager} params.configManager
     */
    constructor({
        resourceLocator,
        clickHouseClientManager,
        mongoStorageProvider,
        configManager
    }) {
        super();
        this.resourceLocator = resourceLocator;
        this.clickHouseClientManager = clickHouseClientManager;
        this.mongoStorageProvider = mongoStorageProvider;
        this.configManager = configManager;
    }

    /**
     * Builds count query for active members of a Group
     * Uses HAVING pattern (canonical for ID-only queries on AggregatingMergeTree)
     * Active-by-default: Counts only event_type=MEMBER_ADDED AND inactive=0 members
     *
     * @param {string} groupId - Group ID
     * @returns {{query: string, query_params: Object}}
     * @private
     */
    _buildCountQuery(groupId) {
        return {
            query: `
                SELECT count() as count
                FROM (
                    SELECT entity_reference
                    FROM ${TABLES.GROUP_MEMBER_CURRENT_BY_ENTITY} FINAL  -- need to force sync with MVs
                    WHERE group_id = {groupId:String}
                    GROUP BY entity_reference
                    HAVING argMaxMerge(event_type) = '${EVENT_TYPES.MEMBER_ADDED}'
                       AND argMaxMerge(inactive) = 0
                )
            `,
            query_params: { groupId }
        };
    }

    /**
     * Builds roster query for active members of a Group
     * Uses canonical subquery + outer WHERE pattern (for AggregatingMergeTree)
     * Active-by-default: Returns only event_type=MEMBER_ADDED AND inactive=0 members
     *
     * @param {string} groupId - Group ID
     * @param {Object} options
     * @param {number} options.limit - Page size
     * @param {string|null} options.afterReference - Seek cursor (entity_reference to start after)
     * @returns {{query: string, query_params: Object}}
     * @private
     */
    _buildRosterQuery(groupId, { limit, afterReference = null }) {
        const params = { groupId, limit };
        const cursorClause = afterReference
            ? 'AND entity_reference > {afterReference:String}'
            : '';

        if (afterReference) {
            params.afterReference = afterReference;
        }

        return {
            query: `
                SELECT
                    entity_reference,
                    entity_type,
                    inactive
                FROM (
                    SELECT
                        entity_reference,
                        argMaxMerge(entity_type) AS entity_type,
                        argMaxMerge(event_type)  AS event_type,
                        argMaxMerge(inactive)    AS inactive
                    FROM ${TABLES.GROUP_MEMBER_CURRENT_BY_ENTITY} FINAL  -- need FINAL to force sync with MVs
                    WHERE group_id = {groupId:String}
                    GROUP BY entity_reference
                )
                WHERE event_type = '${EVENT_TYPES.MEMBER_ADDED}'
                  AND inactive = 0
                  ${cursorClause}
                ORDER BY entity_reference
                LIMIT {limit:UInt32}
            `,
            query_params: params
        };
    }

    /**
     * Get current members with total count from materialized current state table
     * Uses argMaxMerge on pre-aggregated state (not argMax on events)
     * Returns only active members (event_type=MEMBER_ADDED AND inactive=0)
     *
     * @param {string} groupId - Group ID to query
     * @param {Object} options - Query options
     * @param {number} options.limit - Page size (default 100)
     * @param {string|null} options.afterReference - Seek cursor (entity_reference to start after)
     * @returns {Promise<{members: Array<Object>, totalCount: number}>}
     */
    async getCurrentMembersWithCountAsync(groupId, { limit = 100, afterReference = null } = {}) {
        try {
            const countQuery = this._buildCountQuery(groupId);
            const rosterQuery = this._buildRosterQuery(groupId, { limit, afterReference });

            // Run queries in parallel for performance
            const [countResult, members] = await Promise.all([
                this.clickHouseClientManager.queryAsync(countQuery),
                this.clickHouseClientManager.queryAsync(rosterQuery)
            ]);

            const totalCount = countResult.length > 0 ? parseInt(countResult[0].count) : 0;

            return {
                members,
                totalCount
            };
        } catch (error) {
            logError('Error querying current members from ClickHouse current state table', {
                error: error.message,
                groupId,
                limit,
                afterReference
            });

            throw new RethrownError({
                message: 'Error getting current members with count from ClickHouse',
                error,
                args: { groupId, limit, afterReference }
            });
        }
    }

    /**
     * Get member count only (for metadata-only GET / Group.quantity)
     * Uses argMaxMerge on pre-aggregated current state table
     * Counts members where event_type=MEMBER_ADDED AND inactive=0
     *
     * @param {string} groupId - Group ID to query
     * @returns {Promise<number>} Count of active, non-inactive members
     */
    async getActiveMemberCountAsync(groupId) {
        try {
            const query = `
                SELECT count() as count
                FROM (
                    SELECT entity_reference
                    FROM ${TABLES.GROUP_MEMBER_CURRENT_BY_ENTITY} FINAL  -- need to force sync with MVs
                    WHERE group_id = {groupId:String}
                    GROUP BY entity_reference
                    HAVING argMaxMerge(event_type) = '${EVENT_TYPES.MEMBER_ADDED}' AND argMaxMerge(inactive) = 0
                )
            `;

            const result = await this.clickHouseClientManager.queryAsync({
                query,
                query_params: { groupId }
            });

            return parseInt(result[0]?.count || 0);
        } catch (error) {
            logError('Error querying active member count from ClickHouse current state table', {
                error: error.message,
                groupId
            });

            throw new RethrownError({
                message: 'Error getting active member count from ClickHouse',
                error,
                args: { groupId }
            });
        }
    }

    /**
     * Search groups by member (GET /Group?member.entity._reference=Patient/X)
     * Tuple tie-breaker ensures deterministic argMax
     *
     * @param {string} memberReference - Member reference to search for
     * @returns {Promise<Array<Object>>} Array of { group_id } objects
     */
    async findGroupsByMemberAsync(memberReference) {
        try {
            const query = `
                SELECT DISTINCT group_id
                FROM (
                    SELECT
                        group_id,
                        ${QueryFragments.argMaxWithTieBreaker('event_type')} as latest_event
                    FROM ${TABLES.GROUP_MEMBER_EVENTS}
                    ${QueryFragments.whereEntityReference('', true)}
                    GROUP BY group_id
                )
                WHERE latest_event = '${EVENT_TYPES.MEMBER_ADDED}'
            `;

            const result = await this.clickHouseClientManager.queryAsync({
                query,
                query_params: { memberReference }
            });

            return result || [];
        } catch (error) {
            logError('Error finding groups by member in ClickHouse', {
                error: error.message,
                memberReference
            });

            throw new RethrownError({
                message: 'Error finding groups by member in ClickHouse',
                error,
                args: { memberReference }
            });
        }
    }

    /**
     * Finds resources - routes to ClickHouse for member queries, MongoDB for others
     * @param {Object} params
     * @param {Object} params.query
     * @param {Object} [params.options]
     * @param {Object} [params.extraInfo]
     * @returns {Promise<import('../databaseCursor').DatabaseCursor>}
     */
    async findAsync({ query, options, extraInfo }) {
        try {
            // Detect if this is a member query
            const isMemberQuery = this._isMemberQuery(query);

            if (isMemberQuery) {
                logInfo('Routing Group member query to ClickHouse', {
                    query,
                    limit: options?.limit
                });
                return await this._findGroupsByMemberFromClickHouse({ query, options, extraInfo });
            }

            // Fall back to MongoDB for metadata queries
            logDebug('Routing Group metadata query to MongoDB', { query });
            return await this.mongoStorageProvider.findAsync({ query, options, extraInfo });
        } catch (error) {
            logError('Error in MongoWithClickHouseStorageProvider.findAsync', {
                error: error.message,
                stack: error.stack,
                query
            });

            throw error;
        }
    }

    /**
     * Finds one resource - always uses MongoDB (Groups metadata stored there)
     * @param {Object} params
     * @param {Object} params.query
     * @param {Object} [params.options]
     * @returns {Promise<Object|null>}
     */
    async findOneAsync({ query, options }) {
        // Group metadata queries go to MongoDB
        // In future, could reconstruct full Group with members from ClickHouse
        return await this.mongoStorageProvider.findOneAsync({ query, options });
    }

    /**
     * Inserts/updates resources with dual-write to MongoDB and ClickHouse
     * @param {Object} params
     * @param {Array<Object>} params.resources
     * @param {Object} [params.options]
     * @returns {Promise<Object>}
     */
    async upsertAsync({ resources, options }) {
        const results = [];

        try {
            for (const resource of resources) {
                // 1. Write Group metadata to MongoDB (always)
                const mongoResult = await this.mongoStorageProvider.upsertAsync({
                    resources: [resource],
                    options
                });

                // 2. Member events are handled by post-save handler
                // (clickHouseGroupHandler.js) - no need to duplicate logic here

                results.push(mongoResult);
            }

            return {
                acknowledged: true,
                insertedCount: results.length
            };
        } catch (error) {
            logError('Error in ClickHouseStorageProvider.upsertAsync', {
                error: error.message,
                resourceCount: resources.length
            });

            throw new RethrownError({
                message: 'Error in dual-write to MongoDB and ClickHouse',
                error,
                args: { resourceCount: resources.length }
            });
        }
    }

    /**
     * Counts resources - uses MongoDB
     * @param {Object} params
     * @param {Object} params.query
     * @returns {Promise<number>}
     */
    async countAsync({ query }) {
        // For member queries, get count from ClickHouse
        const isMemberQuery = this._isMemberQuery(query);
        if (isMemberQuery) {
            // Extract member criteria to build ClickHouse count query
            const extractedCriteria = this._extractMemberCriteria(query);
            const { memberUuid, memberSourceId, memberReference } = extractedCriteria;

            let whereClause = '';
            const queryParams = {};

            if (memberReference) {
                whereClause = 'WHERE entity_reference = {memberReference:String}';
                queryParams.memberReference = memberReference;
            } else if (memberSourceId && memberSourceId.includes('/')) {
                whereClause = 'WHERE entity_reference = {memberSourceId:String}';
                queryParams.memberSourceId = memberSourceId;
            } else {
                // Fall back to MongoDB if no valid member criteria
                return await this.mongoStorageProvider.countAsync({ query });
            }

            // Build count query matching the findAsync query logic
            const countQuery = `
                SELECT count() as total
                FROM (
                    SELECT group_id
                    FROM ${TABLES.GROUP_MEMBER_CURRENT_BY_ENTITY} FINAL
                    ${whereClause}
                    GROUP BY group_id
                    HAVING argMaxMerge(event_type) = '${EVENT_TYPES.MEMBER_ADDED}' AND argMaxMerge(inactive) = 0
                )
            `;

            try {
                const result = await this.clickHouseClientManager.queryAsync({
                    query: countQuery,
                    query_params: queryParams
                });
                return parseInt(result[0]?.total) || 0;
            } catch (error) {
                logError('Error executing ClickHouse count query', {
                    error: error.message,
                    query: countQuery,
                    queryParams
                });
                throw error;
            }
        }

        // For non-member queries, delegate to MongoDB
        return await this.mongoStorageProvider.countAsync({ query });
    }

    /**
     * Returns storage type identifier
     * @returns {string}
     */
    getStorageType() {
        return STORAGE_PROVIDER_TYPES.MONGO_WITH_CLICKHOUSE;
    }

    // ========== Private Methods ==========

    /**
     * Detects if query is searching for Group members
     * @param {Object} query
     * @returns {boolean}
     * @private
     */
    _isMemberQuery(query) {
        return this._hasField(query, this._isMemberField.bind(this));
    }

    /**
     * Checks if a field key represents a member field
     * @param {string} key - Field key to check
     * @returns {boolean}
     * @private
     */
    _isMemberField(key) {
        return key === 'member' || key.startsWith('member.');
    }

    /**
     * Recursively checks if a query object contains a field matching the checker function
     * Handles MongoDB operators like $and and $or
     *
     * @param {Object} obj - Query object to search
     * @param {Function} fieldChecker - Function that returns true if field matches criteria
     * @returns {boolean}
     * @private
     */
    _hasField(obj, fieldChecker) {
        if (!obj || typeof obj !== 'object') return false;

        for (const [key, value] of Object.entries(obj)) {
            if (fieldChecker(key)) return true;

            if (key === '$and' || key === '$or') {
                if (Array.isArray(value) &&
                    value.some(v => this._hasField(v, fieldChecker))) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Extracts member search criteria from query (handles nested $and/$or)
     * @param {Object} query
     * @returns {{memberUuid: string|null, memberSourceId: string|null, memberReference: string|null}}
     * @private
     */
    _extractMemberCriteria(query) {
        const result = {
            memberUuid: null,
            memberSourceId: null,
            memberReference: null
        };

        /**
         * Unwraps MongoDB operators like $in, $eq to get the actual value
         * @param {*} value - The value to unwrap
         * @returns {*} The unwrapped value
         */
        const unwrapValue = (value) => {
            if (value && typeof value === 'object') {
                // Handle $in operator - take first value from array
                if (value.$in && Array.isArray(value.$in) && value.$in.length > 0) {
                    return value.$in[0];
                }
                // Handle $eq operator
                if (value.$eq !== undefined) {
                    return value.$eq;
                }
                // Handle other operators that might contain the value
                if (value.$regex) {
                    return value.$regex;
                }
            }
            return value;
        };

        // Direct field extraction with operator unwrapping
        if (query['member.entity._uuid']) {
            result.memberUuid = unwrapValue(query['member.entity._uuid']);
        }
        if (query['member.entity._sourceId']) {
            result.memberSourceId = unwrapValue(query['member.entity._sourceId']);
        }
        if (query['member.entity.reference']) {
            result.memberReference = unwrapValue(query['member.entity.reference']);
        }
        if (query['member']) {
            result.memberReference = unwrapValue(query['member']);
        }

        // Extract from $and array
        if (query.$and && Array.isArray(query.$and)) {
            for (const condition of query.$and) {
                const extracted = this._extractMemberCriteria(condition);
                if (extracted.memberUuid) result.memberUuid = extracted.memberUuid;
                if (extracted.memberSourceId) result.memberSourceId = extracted.memberSourceId;
                if (extracted.memberReference) result.memberReference = extracted.memberReference;
            }
        }

        // Extract from $or array
        if (query.$or && Array.isArray(query.$or)) {
            for (const condition of query.$or) {
                const extracted = this._extractMemberCriteria(condition);
                if (extracted.memberUuid) result.memberUuid = extracted.memberUuid;
                if (extracted.memberSourceId) result.memberSourceId = extracted.memberSourceId;
                if (extracted.memberReference) result.memberReference = extracted.memberReference;
            }
        }

        logInfo('Extracted member criteria', {
            query: JSON.stringify(query),
            result
        });

        return result;
    }

    /**
     * Queries ClickHouse for Groups containing specified member
     * Uses argMax with tuple tie-breaker for deterministic results
     *
     * @param {Object} params
     * @param {Object} params.query
     * @param {Object} [params.options]
     * @param {Object} [params.extraInfo]
     * @returns {Promise<import('../databaseCursor').DatabaseCursor>}
     * @private
     */
    async _findGroupsByMemberFromClickHouse({ query, options, extraInfo }) {
        try {
            // Extract pagination parameters first
            const limit = options?.limit || 100;
            const skip = options?.skip || 0;

            // Extract _uuid.$gt from MongoDB query (id:above is converted to { _uuid: { $gt: value } } by fieldMapper)
            let afterGroupId = '';
            if (query._uuid && query._uuid.$gt) {
                afterGroupId = query._uuid.$gt;
            } else if (query.$and && Array.isArray(query.$and)) {
                // Check if _uuid.$gt is nested in $and
                for (const condition of query.$and) {
                    if (condition._uuid && condition._uuid.$gt) {
                        afterGroupId = condition._uuid.$gt;
                        break;
                    }
                }
            }

            // Remove _uuid.$gt from query since it's not a member search criterion (it's for pagination)
            const cleanQuery = { ...query };
            if (cleanQuery._uuid) {
                delete cleanQuery._uuid;
            }
            // Also remove from $and array if present
            if (cleanQuery.$and && Array.isArray(cleanQuery.$and)) {
                cleanQuery.$and = cleanQuery.$and.filter(condition => !condition._uuid || !condition._uuid.$gt);
                // If $and is now empty or has only one item, simplify
                if (cleanQuery.$and.length === 0) {
                    delete cleanQuery.$and;
                } else if (cleanQuery.$and.length === 1) {
                    const singleCondition = cleanQuery.$and[0];
                    delete cleanQuery.$and;
                    Object.assign(cleanQuery, singleCondition);
                }
            }

            // Extract member search criteria from query (may be nested in $and/$or)
            const extractedCriteria = this._extractMemberCriteria(cleanQuery);
            const { memberUuid, memberSourceId, memberReference } = extractedCriteria;

            logDebug('Extracted member search criteria', {
                memberUuid,
                memberSourceId,
                memberReference
            });

            // Build ClickHouse query with argMax and tuple tie-breaker
            let whereClause = '';
            const queryParams = {};

            // Note: Current schema uses entity_reference (not member_reference)
            // and doesn't have member_uuid or member_source_id fields
            // Search by entity_reference only
            if (memberReference) {
                whereClause = 'WHERE entity_reference = {memberReference:String}';
                queryParams.memberReference = memberReference;
            } else if (memberSourceId) {
                // If memberSourceId looks like a full reference (has /), use it directly
                // Otherwise, we'd need to know the resource type to construct the reference
                if (memberSourceId.includes('/')) {
                    whereClause = 'WHERE entity_reference = {memberSourceId:String}';
                    queryParams.memberSourceId = memberSourceId;
                } else {
                    // Can't search by ID alone without resource type - would need fuzzy match
                    // This is a limitation of the simplified schema
                    logWarn('Cannot search by member source ID without full reference', {
                        memberSourceId
                    });
                    return await this.mongoStorageProvider.findAsync({ query, options, extraInfo });
                }
            } else if (memberUuid) {
                // UUID not stored in new schema - fall back to MongoDB
                logWarn('UUID search not supported in new schema, falling back to MongoDB', {
                    memberUuid
                });
                return await this.mongoStorageProvider.findAsync({ query, options, extraInfo });
            } else {
                // No member criteria found - fall back to MongoDB
                logWarn('No member criteria extracted from query, falling back to MongoDB', {
                    query
                });
                return await this.mongoStorageProvider.findAsync({ query, options, extraInfo });
            }

            // Build page query with pagination
            // Prefer seek cursor (id:above) for performance, fall back to OFFSET if numeric skip is used
            let pageQuery;
            if (afterGroupId) {
                // Seek cursor pagination - O(log n) at any depth
                pageQuery = `
                    SELECT group_id
                    FROM ${TABLES.GROUP_MEMBER_CURRENT_BY_ENTITY} FINAL
                    ${whereClause}
                      AND group_id > {afterGroupId:String}
                    GROUP BY group_id
                    HAVING argMaxMerge(event_type) = '${EVENT_TYPES.MEMBER_ADDED}' AND argMaxMerge(inactive) = 0
                    ORDER BY group_id
                    LIMIT {limit:UInt32}
                `;
                queryParams.afterGroupId = afterGroupId;
            } else if (skip > 0) {
                // Numeric offset pagination - O(n) but simpler for tests
                pageQuery = `
                    SELECT group_id
                    FROM ${TABLES.GROUP_MEMBER_CURRENT_BY_ENTITY} FINAL
                    ${whereClause}
                    GROUP BY group_id
                    HAVING argMaxMerge(event_type) = '${EVENT_TYPES.MEMBER_ADDED}' AND argMaxMerge(inactive) = 0
                    ORDER BY group_id
                    LIMIT {limit:UInt32}
                    OFFSET {skip:UInt32}
                `;
                queryParams.skip = skip;
            } else {
                // No pagination params - first page
                pageQuery = `
                    SELECT group_id
                    FROM ${TABLES.GROUP_MEMBER_CURRENT_BY_ENTITY} FINAL
                    ${whereClause}
                    GROUP BY group_id
                    HAVING argMaxMerge(event_type) = '${EVENT_TYPES.MEMBER_ADDED}' AND argMaxMerge(inactive) = 0
                    ORDER BY group_id
                    LIMIT {limit:UInt32}
                `;
            }
            queryParams.limit = limit;

            logInfo('Executing ClickHouse member search with seek cursor pagination', {
                memberReference: queryParams.memberReference || queryParams.memberSourceId,
                afterGroupId,
                limit
            });

            // Execute page query
            let pageResult;
            try {
                pageResult = await this.clickHouseClientManager.queryAsync({
                    query: pageQuery,
                    query_params: queryParams
                });
            } catch (queryError) {
                logError('Error executing ClickHouse query', {
                    error: queryError.message,
                    stack: queryError.stack,
                    pageQuery,
                    queryParams
                });
                throw queryError;
            }

            const groupIds = (pageResult || []).map(row => row.group_id);

            logInfo('ClickHouse member search results', {
                memberReference,
                pageSize: groupIds.length,
                afterGroupId
            });

            // Fetch full Group resources from MongoDB using ONLY this page's IDs
            if (groupIds.length === 0) {
                return await this.mongoStorageProvider.findAsync({
                    query: { id: { $in: [] } },
                    options: { ...options, limit: undefined, skip: undefined, sort: undefined },
                    extraInfo
                });
            }

            // MongoDB fetches ONLY this page (no skip/limit/sort - ClickHouse handled pagination)
            const mongoQuery = { id: { $in: groupIds } };
            const mongoOptions = {
                ...options,
                limit: groupIds.length,  // Limit to this page size
                skip: undefined,         // ClickHouse handled pagination
                sort: [['id', 1]]        // Sort by id ascending to match ClickHouse order
            };

            const mongoResult = await this.mongoStorageProvider.findAsync({
                query: mongoQuery,
                options: mongoOptions,
                extraInfo
            });

            // Set pagination metadata: if we got a full page, there may be more results
            // The bundleManager will use the last resource's id to create the next link
            if (groupIds.length === limit) {
                // Got a full page, might have more results
                // The last_id will be extracted from resources by searchBundle
                mongoResult._hasMore = true;
            }

            return mongoResult;
        } catch (error) {
            logError('Error querying ClickHouse for Groups by member', {
                error: error.message,
                query
            });

            throw new RethrownError({
                message: 'Error finding Groups by member in ClickHouse',
                error,
                args: { query }
            });
        }
    }
}

module.exports = { MongoWithClickHouseStorageProvider };
