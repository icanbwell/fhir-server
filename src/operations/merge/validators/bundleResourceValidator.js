const { BaseValidator } = require('./baseValidator');

class BundleResourceValidator extends BaseValidator {
    /**
     * @param {FhirRequestInfo} requestInfo
     * @param {Resource|Resource[]} incomingResources
     * @param {string} base_version
     * @returns {Promise<{preCheckErrors: MergeResultEntry[], validatedObjects: Resource[], wasAList: boolean}>}
     */
    async validate ({ requestInfo, incomingResources, base_version }) {
        // if the incoming request is a bundle then unwrap the bundle
        if (!Array.isArray(incomingResources) && incomingResources.resourceType === 'Bundle') {
            // unwrap the resources
            incomingResources = incomingResources.entry ? incomingResources.entry.map(e => e.resource) : [];
        }

        return { validatedObjects: incomingResources, preCheckErrors: [], wasAList: false };
    }
}

module.exports = {
    BundleResourceValidator
};
