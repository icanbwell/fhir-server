const env = require('var');
const {searchBundle} = require('./searchBundle');
const {assertIsValid} = require('../../utils/assertType');

class SearchOperation {
    constructor() {
    }

    /**
     * does a FHIR Search
     * @param {FhirRequestInfo} requestInfo
     * @param {Object} args
     * @param {string} resourceType
     * @param {boolean} filter
     * @return {Promise<Resource[] | {entry:{resource: Resource}[]}>} array of resources or a bundle
     */
    async search(
        requestInfo, args, resourceType,
        filter = true
    ) {
        assertIsValid(requestInfo !== undefined);
        assertIsValid(args !== undefined);
        assertIsValid(resourceType !== undefined);
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

