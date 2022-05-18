const env = require('var');
const deepcopy = require('deepcopy');
const {isTrue} = require('../../utils/isTrue');
const pRetry = require('p-retry');
const {logError} = require('../common/logging');
const {logMessageToSlack} = require('../../utils/slack.logger');
const {handleElementsQuery} = require('./handleElementsQuery');
const {handleSortQuery} = require('./handleSortQuery');
const {handleCountOption} = require('./handleCountOption');
const {setDefaultLimit} = require('./setDefaultLimit');
const {handleTwoStepSearchOptimizationAsync} = require('./handleTwoStepOptimization');
const {setCursorBatchSize} = require('./setCursorBatchSize');
const {handleGetTotalsAsync} = require('./handleGetTotals');
const {setIndexHint} = require('./setIndexHint');

/**
 * @typedef GetCursorResult
 * @type {object}
 * @property {int | null} cursorBatchSize
 * @property {import('mongodb').FindCursor<import('mongodb').WithId<Document>>} cursor
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
 * @param {Object?} args
 * @param {Set} columns
 * @param {string} resourceName
 * @param {Object} options
 * @param {import('mongodb').Document} query
 * @param {boolean} useAtlas
 * @param {import('mongodb').Collection} collection
 * @param {number} maxMongoTimeMS
 * @param {string | null} user
 * @param {string} mongoCollectionName
 * @param {boolean} isStreaming
 * @param {boolean} useAccessIndex
 * @returns {Promise<GetCursorResult>}
 */
async function getCursorForQueryAsync(args, columns, resourceName, options,
                                 query, useAtlas, collection, maxMongoTimeMS,
                                 user, mongoCollectionName,
                                 isStreaming, useAccessIndex) {
    // if _elements=x,y,z is in url parameters then restrict mongo query to project only those fields
    if (args['_elements']) {
        const __ret = handleElementsQuery(args, columns, resourceName, options, useAccessIndex);
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
    } else if (!isStreaming) {
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
    if (useTwoStepSearchOptimization) {
        const __ret = await handleTwoStepSearchOptimizationAsync(
            options,
            originalQuery,
            query,
            originalOptions,
            collection,
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
     * @type {import('mongodb').FindCursor<import('mongodb').WithId<Document>>}
     */
    let cursorQuery = await collection
        .find(query, options)
        .maxTimeMS(maxMongoTimeMS);

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
     * mongo db cursor
     * https://github.com/mongodb/node-mongodb-native/blob/HEAD/etc/notes/errors.md
     * @type {import('mongodb').FindCursor<import('mongodb').WithId<Document>>}
     */
    let cursor = await pRetry(async () => await cursorQuery, {
        retries: 5,
        onFailedAttempt: async (error) => {
            let msg = `Search ${resourceName}/${JSON.stringify(args)} Retry Number: ${
                error.attemptNumber
            }: ${error.message}`;
            logError(user, msg);
            await logMessageToSlack(msg);
        },
    });

    // find columns being queried and match them to an index
    if (isTrue(env.SET_INDEX_HINTS) || args['_setIndexHint']) {
        const __ret = setIndexHint(indexHint, mongoCollectionName, columns, cursor, user);
        indexHint = __ret.indexHint;
        cursor = __ret.cursor;
    }

    // if _total is specified then ask mongo for the total else set total to 0
    if (args['_total'] && ['accurate', 'estimate'].includes(args['_total'])) {
        total_count = await handleGetTotalsAsync(args, collection, query, maxMongoTimeMS);
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
    getCursorForQueryAsync: getCursorForQueryAsync
};
