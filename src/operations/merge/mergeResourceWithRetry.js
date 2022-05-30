const {merge_resource} = require('./mergeResource');

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
 * @return {Promise<MergeResultEntry>}
 */
async function merge_resource_with_retry(resource_to_merge, resourceName,
                                         scopes, user, path, currentDate,
                                         requestId, baseVersion, scope, collectionName) {
    return await merge_resource(resource_to_merge, resourceName,
        scopes, user, path, currentDate,
        requestId, baseVersion, scope, collectionName);
}

module.exports = {
    merge_resource_with_retry
};
