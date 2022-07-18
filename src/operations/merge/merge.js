const {mergeOld} = require('./old/mergeOld');

/**
 * does a FHIR Merge
 * @param {import('../../utils/requestInfo').RequestInfo} requestInfo
 * @param {Object} args
 * @param {string} resourceName
 * @param {string} collectionName
 * @returns {Promise<MergeResultEntry[]> | Promise<MergeResultEntry>}
 */
module.exports.merge = async (requestInfo, args, resourceName, collectionName) => {
    return mergeOld(requestInfo, args, resourceName, collectionName);
};
