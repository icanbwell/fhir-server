const {assertTypeEquals} = require('../../../utils/assertType');
const {ResourceValidator} = require('../../common/resourceValidator');
const {validationsFailedCounter} = require('../../../utils/prometheus.utils');
const Bundle = require('../../../fhir/classes/4_0_0/resources/bundle');

class BundleResourceValidator {
    /**
     * @param {ResourceValidator} resourceValidator
     */
    constructor({ resourceValidator }) {
        /**
         * @type {ResourceValidator}
         */
        this.resourceValidator = resourceValidator;
        assertTypeEquals(resourceValidator, ResourceValidator);
    }

    /**
     * @param {Object|Object[]} incomingObjects
     * @param {string|null} path
     * @param {date} currentDate
     * @param {string} currentOperationName
     * @param {string} resourceType
     * @returns {Promise<{validatedObjects: Resources[], preCheckErrors: OperationOutcome[], wasAList: boolean}>}
     */
    async validate({ incomingObjects, path, currentDate, currentOperationName, resourceType }) {
        // if the incoming request is a bundle then unwrap the bundle
        if (!Array.isArray(incomingObjects) && incomingObjects['resourceType'] === 'Bundle') {
            /**
             * @type {Object}
             */
            const incomingObject = incomingObjects;
            const bundle1 = new Bundle(incomingObject);
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
                validationsFailedCounter.inc({action: currentOperationName, resourceType}, 1);
                return {validatedObjects: [], preCheckErrors: validationOperationOutcome, wasAList: true};
            }
            // unwrap the resources
            incomingObjects = incomingObjects.entry.map(e => e.resource);
        }

        return {validatedObjects: incomingObjects, preCheckErrors: [], wasAList: false};
    }
}

module.exports = {
    BundleResourceValidator
};
