const { assertTypeEquals } = require('../../../utils/assertType');
const { ResourceValidator } = require('../../common/resourceValidator');
const { validationsFailedCounter } = require('../../../utils/prometheus.utils');
const { BaseValidator } = require('./baseValidator');

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
     * @param {Resource|Resource[]} incomingResources
     * @param {string|null} path
     * @param {date} currentDate
     * @param {string} currentOperationName
     * @param {string} resourceType
     * @returns {Promise<{validatedObjects: Resource[], preCheckErrors: OperationOutcome[], wasAList: boolean}>}
     */
    async validate ({ incomingResources, path, currentDate, currentOperationName, resourceType }) {
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
                    id: bundle1.id,
                    resourceType: 'Bundle',
                    resourceToValidate: bundle1,
                    path,
                    currentDate
                }
            );
            if (validationOperationOutcome && validationOperationOutcome.statusCode === 400) {
                validationsFailedCounter.inc({ action: currentOperationName, resourceType }, 1);
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
