const {logDebug} = require('../common/logging');
const {findDuplicateResources, findUniqueResources} = require('../../utils/list.util');
const async = require('async');
const {mergeResourceWithRetryAsync} = require('./mergeResourceWithRetry');

/**
 * merges a list of resources
 * @param {MongoCollectionManager} collectionManager
 * @param {Resource[]} resources_incoming
 * @param {string|null} user
 * @param {string} resourceType
 * @param {string[]|null} scopes
 * @param {string} path
 * @param {string} currentDate
 * @param {string} requestId
 * @param {string} base_version
 * @param {string} scope
 * @param {import('../../utils/requestInfo').RequestInfo} requestInfo
 * @param {Object} args
 * @param {DatabaseBulkInserter} databaseBulkInserter
 * @param {DatabaseBulkLoader} databaseBulkLoader
 * @returns {Promise<MergeResultEntry[]>}
 */
async function mergeResourceListAsync(collectionManager,
                                      resources_incoming, user,
                                      resourceType, scopes, path,
                                      currentDate, requestId, base_version,
                                      scope, requestInfo,
                                      args,
                                      databaseBulkInserter,
                                      databaseBulkLoader) {
    /**
     * @type {string[]}
     */
    const ids_of_resources = resources_incoming.map(r => r.id);
    logDebug(user,
        '==================' + resourceType + ': Merge received array ' +
        ', len= ' + resources_incoming.length +
        ' [' + ids_of_resources.toString() + '] ' +
        '===================='
    );
    // find items without duplicates and run them in parallel
    // but items with duplicate ids should run in serial, so we can merge them properly (otherwise the first item
    //  may not finish adding to the db before the next item tries to merge
    /**
     * @type {Resource[]}
     */
    const duplicate_id_resources = findDuplicateResources(resources_incoming);
    /**
     * @type {Resource[]}
     */
    const non_duplicate_id_resources = findUniqueResources(resources_incoming);

    await Promise.all([
        async.map(non_duplicate_id_resources, async x => await mergeResourceWithRetryAsync(collectionManager,
            x, resourceType,
            scopes, user, path, currentDate, requestId, base_version, scope, databaseBulkInserter,
            databaseBulkLoader)), // run in parallel
        async.mapSeries(duplicate_id_resources, async x => await mergeResourceWithRetryAsync(collectionManager,
            x, resourceType,
            scopes, user, path, currentDate, requestId, base_version, scope, databaseBulkInserter,
            databaseBulkLoader)) // run in series
    ]);
}

module.exports = {
    mergeResourceListAsync
};
