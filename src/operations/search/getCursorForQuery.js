'use strict';
const env = require('var');
const deepcopy = require('deepcopy');
const {isTrue} = require('../../utils/isTrue');
const {handleElementsQuery} = require('./handleElementsQuery');
const {handleSortQuery} = require('./handleSortQuery');
const {handleCountOption} = require('./handleCountOption');
const {setDefaultLimit} = require('./setDefaultLimit');
const {handleTwoStepSearchOptimizationAsync} = require('./handleTwoStepOptimization');
const {setCursorBatchSize} = require('./setCursorBatchSize');
const {handleGetTotalsAsync} = require('./handleGetTotals');
const {setIndexHint} = require('./setIndexHint');
const {DatabaseQueryManager} = require('../../dataLayer/databaseQueryManager');
const {getCollectionNamesForQueryForResourceType} = require('../common/resourceManager');

/**
 * @typedef GetCursorResult
 * @type {object}
 * @property {int | null} cursorBatchSize
 * @property {DatabasePartitionedCursor} cursor
 * @property {string | null} indexHint
 * @property {boolean} useTwoStepSearchOptimization
 * @property {Set} columns
 * @property {number | null} total_count
 * @property {import('mongodb').Document} query
 * @property {import('mongodb').FindOneOptions} options
 * @property {Resource[]} resources
 * @property {import('mongodb').Document|import('mongodb').Document[]} originalQuery
 * @property {import('mongodb').FindOneOptions|import('mongodb').FindOneOptions[]} originalOptions
 */

/**
 * Create the query and gets the cursor from mongo
 * @param {string} resourceType
 * @param {string} base_version
 * @param {boolean|null} useAtlas
 * @param {Object?} args
 * @param {Set} columns
 * @param {Object} options
 * @param {import('mongodb').Document} query
 * @param {boolean} useAtlas
 * @param {number} maxMongoTimeMS
 * @param {string | null} user
 * @param {boolean} isStreaming
 * @param {boolean} useAccessIndex
 * @returns {Promise<GetCursorResult>}
 */
async function getCursorForQueryAsync(resourceType, base_version, useAtlas,
                                      args, columns, options,
                                      query,
                                      maxMongoTimeMS,
                                      user,
                                      isStreaming, useAccessIndex) {
    // if _elements=x,y,z is in url parameters then restrict mongo query to project only those fields
    if (args['_elements']) {
        const __ret = handleElementsQuery(args, columns, resourceType, options, useAccessIndex);
        columns = __ret.columns;
        options = __ret.options;
    }
    // if _sort is specified then add sort criteria to mongo query
    if (args['_sort']) {
        const __ret = handleSortQuery(args, columns, options);
        columns = __ret.columns;
        options = __ret.options;
    }

    // if _count is specified then limit mongo query to that
    if (args['_count']) {
        const __ret = handleCountOption(args, options, isStreaming);
        options = __ret.options;
    } else {
        setDefaultLimit(args, options, isStreaming);
    }

    // for consistency in results while paging, always sort by id
    // https://docs.mongodb.com/manual/reference/method/cursor.sort/#sort-cursor-consistent-sorting
    const defaultSortId = env.DEFAULT_SORT_ID || 'id';
    columns.add(defaultSortId);
    if (!('sort' in options)) {
        options['sort'] = {};
    }
    // add id to end if not present in sort
    if (!(`${defaultSortId}` in options['sort'])) {
        options['sort'][`${defaultSortId}`] = 1;
    }

    /**
     * queries for logging
     * @type {Object|Object[]}
     */
    let originalQuery = deepcopy(query);
    /**
     * options for logging
     * @type {Object|Object[]}
     */
    let originalOptions = deepcopy(options);

    /**
     * whether to use the two-step optimization
     * In the two-step optimization we request the ids first and then request the documents for those ids
     *  This can be faster in large tables as both queries can then be satisfied by indexes
     * @type {boolean}
     */
    const useTwoStepSearchOptimization =
        !args['_elements'] &&
        !args['id'] &&
        (isTrue(env.USE_TWO_STEP_SEARCH_OPTIMIZATION) || args['_useTwoStepOptimization']);
    if (isTrue(useTwoStepSearchOptimization)) {
        const __ret = await handleTwoStepSearchOptimizationAsync(
            resourceType,
            base_version,
            useAtlas,
            options,
            originalQuery,
            query,
            originalOptions,
            maxMongoTimeMS
        );
        options = __ret.options;
        originalQuery = __ret.originalQuery;
        query = __ret.query;
        originalOptions = __ret.originalOptions;
        if (query === null) {
            // no ids were found so no need to query
            return {
                columns,
                options,
                query,
                originalQuery,
                originalOptions,
                useTwoStepSearchOptimization,
                resources: [],
                total_count: 0,
                indexHint: false,
                cursorBatchSize: 0,
                cursor: null
            };
        }
    }

    /**
     * resources to return
     * @type {Resource[]}
     */
    let resources = [];
    /**
     * @type {number}
     */
    let total_count = 0;
    /**
     * which index hint to use (if any)
     * @type {string|null}
     */
    let indexHint = null;
    /**
     * @type {int | null}
     */
    let cursorBatchSize = null;
    // run the query and get the results
    // Now run the query to get a cursor we will enumerate next
    /**
     * @type {DatabasePartitionedCursor}
     */
    let cursorQuery = await new DatabaseQueryManager(resourceType, base_version, useAtlas)
        .findAsync(query, options);

    if (isStreaming) {
        cursorQuery = cursorQuery.maxTimeMS(60 * 60 * 1000); // if streaming then set time out to an hour
    } else {
        cursorQuery = cursorQuery.maxTimeMS(maxMongoTimeMS);
    }

    // avoid double sorting since Mongo gives you different results
    if (useTwoStepSearchOptimization && !options['sort']) {
        const sortOption =
            originalOptions[0] && originalOptions[0].sort ? originalOptions[0].sort : null;
        if (sortOption !== null) {
            cursorQuery = cursorQuery.sort(sortOption);
        }
    }

    // set batch size if specified
    if (env.MONGO_BATCH_SIZE || args['_cursorBatchSize']) {
        // https://www.dbkoda.com/blog/2017/10/01/bulk-operations-in-mongoDB
        const __ret = setCursorBatchSize(args, cursorQuery);
        cursorBatchSize = __ret.cursorBatchSize;
        cursorQuery = __ret.cursorQuery;
    }
    /**
     * @type {DatabasePartitionedCursor}
     */
    let cursor = cursorQuery;

    // find columns being queried and match them to an index
    if (isTrue(env.SET_INDEX_HINTS) || args['_setIndexHint']) {
        // TODO: handle index hints for multiple collections
        const collectionNamesForQueryForResourceType = getCollectionNamesForQueryForResourceType(resourceType, base_version);
        const __ret = setIndexHint(indexHint, collectionNamesForQueryForResourceType[0], columns, cursor, user);
        indexHint = __ret.indexHint;
        cursor = __ret.cursor;
    }

    // if _total is specified then ask mongo for the total else set total to 0
    if (args['_total'] && ['accurate', 'estimate'].includes(args['_total'])) {
        total_count = await handleGetTotalsAsync(resourceType, base_version, useAtlas, args, query, maxMongoTimeMS);
    }

    return {
        columns,
        options,
        query,
        originalQuery,
        originalOptions,
        useTwoStepSearchOptimization,
        resources,
        total_count,
        indexHint,
        cursorBatchSize,
        cursor
    };
}

module.exports = {
    getCursorForQueryAsync
};
