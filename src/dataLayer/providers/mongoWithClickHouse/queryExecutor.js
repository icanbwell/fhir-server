const { logInfo, logError } = require('../../../operations/common/logging');

/**
 * Executor for ClickHouse Group member queries
 *
 * Orchestrates query execution and result mapping:
 * 1. Execute ClickHouse query for group uuids
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
     * @param {Object|null} [params.residualQuery] - Non-member predicates from the original query
     *   that ClickHouse cannot answer and MongoDB must still apply (see QueryParser.extractResidualQuery)
     * @param {boolean} [params.residualBoundsResultSet] - True when residualQuery narrows on
     *   resource identity, so the result set is bounded and cannot span pages
     * @returns {Promise<import('../../databaseCursor').DatabaseCursor>}
     */
    static async executeGroupMemberSearch({
        clickHouseManager,
        mongoProvider,
        queryDef,
        limit,
        options,
        extraInfo,
        residualQuery = null,
        residualBoundsResultSet = false
    }) {
        // Execute ClickHouse query
        const pageResult = await this._executeClickHouseQuery(clickHouseManager, queryDef);
        const groupUuids = (pageResult || []).map(row => row.group_uuid);

        logInfo('ClickHouse member search results', {
            memberReferenceUuid: queryDef.query_params.memberReferenceUuid,
            memberReferenceSourceId: queryDef.query_params.memberReferenceSourceId,
            pageSize: groupUuids.length
        });

        // Fetch full Group resources from MongoDB
        if (groupUuids.length === 0) {
            return this._fetchEmptyResult(mongoProvider, options, extraInfo);
        }

        const mongoResult = await this._fetchGroupsFromMongo({
            mongoProvider,
            groupUuids,
            options,
            extraInfo,
            residualQuery
        });

        // Set pagination metadata.
        //
        // ClickHouse pages by group_uuid, so a full page means "there may be more Groups".
        // When a residual predicate is applied on the MongoDB side the page can come back
        // short — that is expected and _hasMore stays correct, because the next page is
        // resolved from the last returned resource's _uuid.
        //
        // The one case where a full ClickHouse page must NOT advertise more results is an
        // identity-bounded query (`_id=...`): the result set is at most the ids named, so a
        // "next" link would produce an empty page. residualBoundsResultSet flags that.
        if (groupUuids.length === limit && !residualBoundsResultSet) {
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
     * Fetches full Group resources from MongoDB by _uuid
     *
     * The hand-off is a single $in list, so it has to carry a key that is unique on its own.
     * The FHIR logical id is unique only within a tenant: two tenants can hold Groups with the
     * same id, so an id-based $in returns both and the caller sees another tenant's document.
     *
     * @param {Object} params
     * @param {Object} params.mongoProvider - MongoDB storage provider
     * @param {string[]} params.groupUuids - Group _uuid values from ClickHouse
     * @param {Object} params.options - Original query options
     * @param {Object} params.extraInfo - Extra info for MongoDB query
     * @param {Object|null} [params.residualQuery] - Non-member predicates the original query
     *   carried; ANDed with the uuid list so they are not silently dropped
     * @returns {Promise<import('../../databaseCursor').DatabaseCursor>}
     * @private
     */
    static async _fetchGroupsFromMongo({
        mongoProvider,
        groupUuids,
        options,
        extraInfo,
        residualQuery = null
    }) {
        // MongoDB fetches ONLY this page (no skip/limit/sort - ClickHouse handled pagination),
        // but it must still honor every non-member predicate from the original search.
        const mongoQuery = residualQuery
            ? { $and: [{ _uuid: { $in: groupUuids } }, residualQuery] }
            : { _uuid: { $in: groupUuids } };
        const mongoOptions = {
            ...options,
            limit: groupUuids.length,  // Limit to this page size
            skip: undefined,           // ClickHouse handled pagination
            sort: [['_uuid', 1]]       // Sort by _uuid ascending to match ClickHouse order
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
            query: { _uuid: { $in: [] } },
            options: { ...options, limit: undefined, skip: undefined, sort: undefined },
            extraInfo
        });
    }
}

module.exports = { QueryExecutor };
