/**
 * handle request to return totals for the query
 * @param {Object} args
 * @param {import('mongodb').Collection} collection
 * @param {Object} query
 * @param {number} maxMongoTimeMS
 * @return {Promise<*>}
 */
async function handleGetTotals(args, collection, query, maxMongoTimeMS) {
    // https://www.hl7.org/fhir/search.html#total
    // if _total is passed then calculate the total count for matching records also
    // don't use the options since they set a limit and skip
    if (args['_total'] === 'estimate') {
        return await collection.estimatedDocumentCount(query, {maxTimeMS: maxMongoTimeMS});
    } else {
        return await collection.countDocuments(query, {maxTimeMS: maxMongoTimeMS});
    }
}


module.exports = {
    handleGetTotals: handleGetTotals
};
