const { StorageProvider } = require('./storageProvider');
const { logDebug, logInfo, logError, logWarn } = require('../../operations/common/logging');
const { RethrownError } = require('../../utils/rethrownError');
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

            // Mirror findAsync: honor any requested `_id` so Bundle.total matches
            // the id-filtered Bundle.entry rather than counting every group that
            // contains the member.
            const requestedIds = QueryParser.extractRequestedIds(query);

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
                ownerTags: securityTags.ownerTags,
                requestedIds
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

            // Extract any requested `_id` constraint so we can intersect it with
            // the group ids returned by ClickHouse (ClickHouse filters by member,
            // not by group id). Read from the original query; the extractor only
            // collects equality/$in id values and ignores the $gt pagination cursor.
            const requestedIds = QueryParser.extractRequestedIds(query);

            // Validate criteria
            const validation = QueryParser.validateMemberCriteria(memberCriteria);
            if (!validation.valid) {
                logWarn(`Cannot search by member: ${validation.reason}`, { memberCriteria });
                return await this.mongoStorageProvider.findAsync({ query, options, extraInfo });
            }

            // Build ClickHouse query. The requested `_id` constraint is pushed
            // into the SQL WHERE clause so LIMIT and ordering apply to the
            // id-filtered set (no JS post-filter after the page is truncated).
            const queryDef = QueryBuilder.buildFindGroupsByMemberQuery({
                memberReferenceUuid: validation.entityReferenceUuid,
                memberReferenceSourceId: validation.entityReferenceSourceId,
                accessTags: securityTags.accessTags,
                ownerTags: securityTags.ownerTags,
                limit,
                afterGroupId,
                skip,
                requestedIds
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
