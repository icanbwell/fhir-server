const { StorageProvider } = require('./storageProvider');
const { logDebug, logInfo, logError, logWarn } = require('../../operations/common/logging');
const { RethrownError } = require('../../utils/rethrownError');
const { TABLES, EVENT_TYPES } = require('../../constants/clickHouseConstants');
const { QueryFragments } = require('../../utils/clickHouse/queryFragments');
const { STORAGE_PROVIDER_TYPES } = require('./storageProviderTypes');
const { QueryParser } = require('./mongoWithClickHouse/queryParser');
const { QueryBuilder } = require('./mongoWithClickHouse/queryBuilder');
const { QueryExecutor } = require('./mongoWithClickHouse/queryExecutor');
const { USE_EXTERNAL_STORAGE_HEADER } = require('../../utils/contextDataBuilder');
const { isTrue } = require('../../utils/isTrue');

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
 * - Uses materialized views (Group_4_0_0_MemberCurrentByEntity_MV) for aggregated state
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
        return QueryBuilder.buildActiveMemberCount({ groupId });
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
        return QueryBuilder.buildActiveMembers({ groupId, limit, afterReference });
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
                    FROM ${TABLES.GROUP_MEMBER_CURRENT} FINAL  -- need to force sync with MVs
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
            const useExternal = isTrue(extraInfo?.headers?.[USE_EXTERNAL_STORAGE_HEADER]);

            if (isMemberQuery && useExternal) {
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
    async countAsync({ query, options, extraInfo }) {
        // For member queries, get count from ClickHouse
        const isMemberQuery = this._isMemberQuery(query);
        const useExternal = isTrue(extraInfo?.headers?.[USE_EXTERNAL_STORAGE_HEADER]);
        if (isMemberQuery && useExternal) {
            // Parse and validate member criteria
            const memberCriteria = QueryParser.extractMemberCriteria(query);
            const securityTags = QueryParser.extractSecurityTags(query);
            const validation = QueryParser.validateMemberCriteria(memberCriteria);

            if (!validation.valid) {
                // Fall back to MongoDB if no valid member criteria
                logWarn(`Cannot count by member: ${validation.reason}`, { memberCriteria });
                return await this.mongoStorageProvider.countAsync({ query });
            }

            // Build ClickHouse count query
            const queryDef = QueryBuilder.buildCountGroupsByMemberQuery({
                memberReferenceUuid: validation.entityReferenceUuid,
                memberReferenceSourceId: validation.entityReferenceSourceId,
                accessTags: securityTags.accessTags,
                ownerTags: securityTags.ownerTags
            });

            try {
                const result = await this.clickHouseClientManager.queryAsync(queryDef);
                return parseInt(result[0]?.total) || 0;
            } catch (error) {
                logError('Error executing ClickHouse count query', {
                    error: error.message,
                    query: queryDef.query,
                    queryParams: queryDef.query_params
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
            // Parse query
            const limit = options?.limit || 100;
            const skip = options?.skip || 0;
            const afterGroupId = QueryParser.extractPaginationCursor(query);
            const cleanQuery = QueryParser.cleanPaginationFromQuery(query);

            // Extract criteria
            const memberCriteria = QueryParser.extractMemberCriteria(cleanQuery);
            const securityTags = QueryParser.extractSecurityTags(query);

            // Validate criteria
            const validation = QueryParser.validateMemberCriteria(memberCriteria);
            if (!validation.valid) {
                logWarn(`Cannot search by member: ${validation.reason}`, { memberCriteria });
                return await this.mongoStorageProvider.findAsync({ query, options, extraInfo });
            }

            // Build ClickHouse query
            const queryDef = QueryBuilder.buildFindGroupsByMemberQuery({
                memberReferenceUuid: validation.entityReferenceUuid,
                memberReferenceSourceId: validation.entityReferenceSourceId,
                accessTags: securityTags.accessTags,
                ownerTags: securityTags.ownerTags,
                limit,
                afterGroupId,
                skip
            });

            // Execute and return
            return await QueryExecutor.executeGroupMemberSearch({
                clickHouseManager: this.clickHouseClientManager,
                mongoProvider: this.mongoStorageProvider,
                queryDef,
                limit,
                options,
                extraInfo
            });
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
