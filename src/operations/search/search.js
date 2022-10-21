const env = require('var');
const {searchBundle} = require('./searchBundle');
const {assertIsValid} = require('../../utils/assertType');
const {BadRequestError} = require('../../utils/httpErrors');

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

        // check if required filters for AuditEvent are passed
        if (resourceType === 'AuditEvent') {
            // args must contain one of these
            const requiredFiltersForAuditEvent = this.configManager.requiredFiltersForAuditEvent;
            if (requiredFiltersForAuditEvent && requiredFiltersForAuditEvent.length > 0) {
                if (requiredFiltersForAuditEvent.filter(r => args[`${r}`]).length === 0) {
                    const message = `One of the filters [${requiredFiltersForAuditEvent.join(',')}] are required to query AuditEvent`;
                    throw new BadRequestError(
                        {
                            'message': message,
                            toString: function () {
                                return message;
                            }
                        }
                    );
                }
            }
        }

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

