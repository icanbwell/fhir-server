/**
 * implements a two-step optimization by first retrieving ids and then requesting the data for those ids
 * @param {string} resourceType
 * @param {string} base_version
 * @param {boolean|null} useAtlas
 * @param {Object} options
 * @param {Object|Object[]} originalQuery
 * @param {Object} query
 * @param {Object} originalOptions
 * @param {number} maxMongoTimeMS
 * @return {Promise<{query: Object, options: Object, originalQuery: (Object|Object[]), originalOptions: Object}>}
 */
const {DatabaseQueryManager} = require('../../dataLayer/databaseQueryManager');

async function handleTwoStepSearchOptimizationAsync(
    resourceType,
    base_version,
    useAtlas,
    options,
    originalQuery,
    query,
    originalOptions,
    maxMongoTimeMS
) {
    // first get just the ids
    const projection = {};
    projection['_id'] = 0;
    projection['id'] = 1;
    options['projection'] = projection;
    originalQuery = [query];
    originalOptions = [options];
    const sortOption = originalOptions[0] && originalOptions[0].sort ? originalOptions[0].sort : {};

    let idResults = await new DatabaseQueryManager(resourceType, base_version, useAtlas)
        .findAsync(query, options)
        .sort(sortOption)
        .maxTimeMS(maxMongoTimeMS)
        .toArray();
    if (idResults.length > 0) {
        // now get the documents for those ids.  We can clear all the other query parameters
        query = idResults.length === 1 ?
            {id: idResults.map((r) => r.id)[0]} :
            {id: {$in: idResults.map((r) => r.id)}};
        // query = getQueryWithSecurityTags(securityTags, query);
        options = {}; // reset options since we'll be looking by id
        originalQuery.push(query);
        originalOptions.push(options);
    } else {
        // no results
        query = null; //no need to query
    }
    return {options, originalQuery, query, originalOptions};
}

module.exports = {
    handleTwoStepSearchOptimizationAsync
};
