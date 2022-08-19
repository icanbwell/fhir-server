const env = require('var');
const assert = require('node:assert/strict');
const {searchBundle} = require('./searchBundle');

/**
 * does a FHIR Search
 * @param {SimpleContainer} container
 * @param {import('../../utils/requestInfo').RequestInfo} requestInfo
 * @param {Object} args
 * @param {string} resourceType
 * @param {boolean} filter
 * @return {Promise<Resource[] | {entry:{resource: Resource}[]}>} array of resources or a bundle
 */
module.exports.search = async (
    container,
    requestInfo, args, resourceType,
    filter = true
) => {
    assert(container !== undefined);
    assert(requestInfo !== undefined);
    assert(args !== undefined);
    assert(resourceType !== undefined);
    /**
     * @type {{entry: {resource: Resource}[]}}
     */
    const bundle = await searchBundle(container,
        requestInfo, args, resourceType,
        filter);

    if (env.RETURN_BUNDLE || args['_bundle']) {
        return bundle;
    } else {
        // return resources from bundle
        return bundle.entry.map(e => e.resource);
    }
};
