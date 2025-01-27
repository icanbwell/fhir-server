const { BaseValidator } = require('./baseValidator');
const { ResourceValidator } = require('../../common/resourceValidator');
const { assertTypeEquals } = require('../../../utils/assertType');

class BundleResourceValidator extends BaseValidator {
    /**
     * @param {ResourceValidator} resourceValidator
     */
    constructor ({ resourceValidator }) {
        super();
        /**
         * @type {ResourceValidator}
         */
        this.resourceValidator = resourceValidator;
        assertTypeEquals(resourceValidator, ResourceValidator);
    }

    /**
     * @param {FhirRequestInfo} requestInfo
     * @param {string} currentOperationName
     * @param {Resource|Resource[]} incomingResources
     * @param {string} base_version
     * @returns {Promise<{preCheckErrors: MergeResultEntry[], validatedObjects: Resource[], wasAList: boolean}>}
     */
    async validate ({ requestInfo, currentOperationName, incomingResources, base_version }) {
        // if the incoming request is a bundle then unwrap the bundle
        if (!Array.isArray(incomingResources) && incomingResources.resourceType === 'Bundle') {
            /**
             * @type {Bundle}
             * @type {Resource}
             */
            const bundle1 = incomingResources;
            /**
             * @type {OperationOutcome|null}
             */
            const validationOperationOutcome = await this.resourceValidator.validateResourceAsync(
                {
                    base_version,
                    requestInfo,
                    id: bundle1.id,
                    resourceType: 'Bundle',
                    resourceToValidate: bundle1,
                    path: requestInfo.path
                }
            );
            if (validationOperationOutcome && validationOperationOutcome.statusCode === 400) {
                return { validatedObjects: [], preCheckErrors: [validationOperationOutcome], wasAList: true };
            }
            // unwrap the resources
            incomingResources = incomingResources.entry ? incomingResources.entry.map(e => e.resource) : [];
        }

        return { validatedObjects: incomingResources, preCheckErrors: [], wasAList: false };
    }
}

module.exports = {
    BundleResourceValidator
};
