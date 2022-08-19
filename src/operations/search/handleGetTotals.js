const {DatabaseQueryManager} = require('../../dataLayer/databaseQueryManager');

/**
 * handle request to return totals for the query
 * @param {MongoCollectionManager} collectionManager
 * @param {string} resourceType
 * @param {string} base_version
 * @param {boolean|null} useAtlas
 * @param {Object} args
 * @param {Object} query
 * @param {number} maxMongoTimeMS
 * @return {Promise<*>}
 */
async function handleGetTotalsAsync(collectionManager,
    resourceType, base_version, useAtlas, args, query, maxMongoTimeMS) {
    // https://www.hl7.org/fhir/search.html#total
    // if _total is passed then calculate the total count for matching records also
    // don't use the options since they set a limit and skip
    if (args['_total'] === 'estimate') {
        return await new DatabaseQueryManager(collectionManager,
            resourceType, base_version, useAtlas)
            .estimatedDocumentCountAsync(query, {maxTimeMS: maxMongoTimeMS});
    } else {
        return await new DatabaseQueryManager(collectionManager,
            resourceType, base_version, useAtlas)
            .exactDocumentCountAsync(query, {maxTimeMS: maxMongoTimeMS});
    }
}


module.exports = {
    handleGetTotalsAsync
};
