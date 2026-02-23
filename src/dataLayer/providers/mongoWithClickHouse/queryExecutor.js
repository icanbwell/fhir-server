const { logInfo, logError } = require('../../../operations/common/logging');

/**
 * Executor for ClickHouse Group member queries
 *
 * Orchestrates query execution and result mapping:
 * 1. Execute ClickHouse query for group IDs
 * 2. Fetch full Group resources from MongoDB
 * 3. Set pagination metadata
 */
class QueryExecutor {
    /**
     * Executes full group member search workflow
     *
     * @param {Object} params
     * @param {Object} params.clickHouseManager - ClickHouse client manager
     * @param {Object} params.mongoProvider - MongoDB storage provider
     * @param {Object} params.queryDef - Query definition from QueryBuilder
     * @param {string} params.queryDef.query - SQL query string
     * @param {Object} params.queryDef.query_params - Query parameters
     * @param {number} params.limit - Page size
     * @param {Object} params.options - Original query options
     * @param {Object} params.extraInfo - Extra info for MongoDB query
     * @returns {Promise<import('../../databaseCursor').DatabaseCursor>}
     */
    static async executeGroupMemberSearch({
        clickHouseManager,
        mongoProvider,
        queryDef,
        limit,
        options,
        extraInfo
    }) {
        // Execute ClickHouse query
        const pageResult = await this._executeClickHouseQuery(clickHouseManager, queryDef);
        const groupIds = (pageResult || []).map(row => row.group_id);

        logInfo('ClickHouse member search results', {
            memberReference: queryDef.query_params.memberReference,
            pageSize: groupIds.length
        });

        // Fetch full Group resources from MongoDB
        if (groupIds.length === 0) {
            return this._fetchEmptyResult(mongoProvider, options, extraInfo);
        }

        const mongoResult = await this._fetchGroupsFromMongo({
            mongoProvider,
            groupIds,
            options,
            extraInfo
        });

        // Set pagination metadata
        if (groupIds.length === limit) {
            // Got a full page, might have more results
            // The bundleManager will use the last resource's id to create the next link
            mongoResult._hasMore = true;
        }

        return mongoResult;
    }

    /**
     * Executes ClickHouse query with error handling
     *
     * @param {Object} manager - ClickHouse client manager
     * @param {Object} queryDef - Query definition
     * @param {string} queryDef.query - SQL query string
     * @param {Object} queryDef.query_params - Query parameters
     * @returns {Promise<Array>} Query results
     * @private
     */
    static async _executeClickHouseQuery(manager, queryDef) {
        try {
            return await manager.queryAsync(queryDef);
        } catch (queryError) {
            logError('Error executing ClickHouse query', {
                error: queryError.message,
                stack: queryError.stack,
                query: queryDef.query,
                queryParams: queryDef.query_params
            });
            throw queryError;
        }
    }

    /**
     * Fetches full Group resources from MongoDB by IDs
     *
     * @param {Object} params
     * @param {Object} params.mongoProvider - MongoDB storage provider
     * @param {string[]} params.groupIds - Group IDs from ClickHouse
     * @param {Object} params.options - Original query options
     * @param {Object} params.extraInfo - Extra info for MongoDB query
     * @returns {Promise<import('../../databaseCursor').DatabaseCursor>}
     * @private
     */
    static async _fetchGroupsFromMongo({
        mongoProvider,
        groupIds,
        options,
        extraInfo
    }) {
        // MongoDB fetches ONLY this page (no skip/limit/sort - ClickHouse handled pagination)
        const mongoQuery = { id: { $in: groupIds } };
        const mongoOptions = {
            ...options,
            limit: groupIds.length,  // Limit to this page size
            skip: undefined,         // ClickHouse handled pagination
            sort: [['id', 1]]        // Sort by id ascending to match ClickHouse order
        };

        return await mongoProvider.findAsync({
            query: mongoQuery,
            options: mongoOptions,
            extraInfo
        });
    }

    /**
     * Returns empty result set when ClickHouse query returns no results
     *
     * @param {Object} mongoProvider - MongoDB storage provider
     * @param {Object} options - Original query options
     * @param {Object} extraInfo - Extra info for MongoDB query
     * @returns {Promise<import('../../databaseCursor').DatabaseCursor>}
     * @private
     */
    static async _fetchEmptyResult(mongoProvider, options, extraInfo) {
        return await mongoProvider.findAsync({
            query: { id: { $in: [] } },
            options: { ...options, limit: undefined, skip: undefined, sort: undefined },
            extraInfo
        });
    }
}

module.exports = { QueryExecutor };
