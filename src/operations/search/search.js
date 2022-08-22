const env = require('var');
const assert = require('node:assert/strict');
const {searchBundle} = require('./searchBundle');

class SearchOperation {
    constructor() {
    }


    /**
     * does a FHIR Search
     * @param {import('../../utils/requestInfo').RequestInfo} requestInfo
     * @param {Object} args
     * @param {string} resourceType
     * @param {boolean} filter
     * @return {Promise<Resource[] | {entry:{resource: Resource}[]}>} array of resources or a bundle
     */
    async search(
        requestInfo, args, resourceType,
        filter = true
    ) {
        assert(requestInfo !== undefined);
        assert(args !== undefined);
        assert(resourceType !== undefined);
        /**
         * @type {{entry: {resource: Resource}[]}}
         */
        const bundle = await searchBundle(
            requestInfo, args, resourceType,
            filter);

        if (env.RETURN_BUNDLE || args['_bundle']) {
            return bundle;
        } else {
            // return resources from bundle
            return bundle.entry.map(e => e.resource);
        }
    }
}

module.exports = {
    SearchOperation
};

