const {mergeResourceAsync} = require('./mergeResource');

/**
 * Tries to merge and retries if there is an error to protect against race conditions where 2 calls are happening
 *  in parallel for the same resource. Both of them see that the resource does not exist, one of them inserts it
 *  and then the other ones tries to insert too
 * @param {Object} resource_to_merge
 * @param {string} resourceName
 * @param {string[] | null} scopes
 * @param {string|null} user
 * @param {string} path
 * @param {string} currentDate
 * @param {string} requestId
 * @param {string} baseVersion
 * @param {string} scope
 * @param {string} collectionName
 * @param {DatabaseBulkInserter} databaseBulkInserter
 * @param {{resources: Resource[], resourceType: string}[]} existingResourcesByResourceType
 * @return {Promise<void>}
 */
async function mergeResourceWithRetryAsync(resource_to_merge, resourceName,
                                           scopes, user, path, currentDate,
                                           requestId, baseVersion, scope, collectionName,
                                           databaseBulkInserter,
                                           existingResourcesByResourceType) {
    await mergeResourceAsync(resource_to_merge, resourceName,
        scopes, user, path, currentDate,
        requestId, baseVersion, scope, collectionName,
        databaseBulkInserter, existingResourcesByResourceType);
}

module.exports = {
    mergeResourceWithRetryAsync
};
