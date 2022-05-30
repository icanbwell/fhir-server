const {logRequest, logDebug} = require('../common/logging');
const {findDuplicateResources, findUniqueResources} = require('../../utils/list.util');
const async = require('async');
const {merge_resource_with_retry} = require('./mergeResourceWithRetry');
const {logAuditEntryAsync} = require('../../utils/auditLogger');

/**
 * merges a list of resources
 * @param {Resource[]} resources_incoming
 * @param {string|null} user
 * @param {string} resource_name
 * @param {string[]|null} scopes
 * @param {string} path
 * @param {string} currentDate
 * @param {string} requestId
 * @param {string} base_version
 * @param {string} scope
 * @param {string} collection_name
 * @param {import('../../utils/requestInfo').RequestInfo} requestInfo
 * @param {Object} args
 * @returns {Promise<FlatArray<*[], 1>[]>}
 */
async function mergeResourceList(resources_incoming, user,
                                 resource_name, scopes, path,
                                 currentDate, requestId, base_version,
                                 scope, collection_name, requestInfo,
                                 args) {
    /**
     * @type {string[]}
     */
    const ids_of_resources = resources_incoming.map(r => r.id);
    logRequest(user,
        '==================' + resource_name + ': Merge received array ' +
        ', len= ' + resources_incoming.length +
        ' [' + ids_of_resources.toString() + '] ' +
        '===================='
    );
    // find items without duplicates and run them in parallel
    // but items with duplicate ids should run in serial, so we can merge them properly (otherwise the first item
    //  may not finish adding to the db before the next item tries to merge
    /**
     * @type {Object[]}
     */
    const duplicate_id_resources = findDuplicateResources(resources_incoming);
    /**
     * @type {Object[]}
     */
    const non_duplicate_id_resources = findUniqueResources(resources_incoming);

    /**
     * @type {Awaited<unknown>[]}
     */
    const result = await Promise.all([
        async.map(non_duplicate_id_resources, async x => await merge_resource_with_retry(x, resource_name,
            scopes, user, path, currentDate, requestId, base_version, scope, collection_name)), // run in parallel
        async.mapSeries(duplicate_id_resources, async x => await merge_resource_with_retry(x, resource_name,
            scopes, user, path, currentDate, requestId, base_version, scope, collection_name)) // run in series
    ]);
    /**
     * @type {FlatArray<unknown[], 1>[]}
     */
    const returnVal = result.flat(1);
    if (returnVal && returnVal.length > 0) {
        const createdItems = returnVal.filter(r => r['created'] === true);
        const updatedItems = returnVal.filter(r => r['updated'] === true);
        if (createdItems && createdItems.length > 0) {
            if (resource_name !== 'AuditEvent') {
                await logAuditEntryAsync(requestInfo, base_version, resource_name, 'create', args, createdItems.map(r => r['id']));
            }
        }
        if (updatedItems && updatedItems.length > 0) {
            if (resource_name !== 'AuditEvent') {
                await logAuditEntryAsync(requestInfo, base_version, resource_name, 'update', args, updatedItems.map(r => r['id']));
            }
        }
    }

    logDebug(user, '--- Merge array result ----');
    logDebug(user, JSON.stringify(returnVal));
    logDebug(user, '-----------------');
    return returnVal;
}


module.exports = {
    mergeResourceList
};
