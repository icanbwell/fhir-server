const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');

class MergeValidator {
    /**
     * @param {BaseValidator[]} validators
     */
    constructor ({ validators }) {
        /**
         * @type {BaseValidator[]}
         */
        this.validators = validators;
    }

    /**
     * @param {string} base_version
     * @param {string} currentOperationName
     * @param {Object|Object[]} incomingObjects
     * @param {string} resourceType
     * @param {FhirRequestInfo} requestInfo
     * @returns {Promise<{mergePreCheckErrors: MergeResultEntry[], resourcesIncomingArray: Resource[], wasIncomingAList: boolean}>}
     */
    async validateAsync ({
        base_version,
        currentOperationName,
        incomingObjects,
        resourceType,
        requestInfo
    }) {
        /**
         * @type {MergeResultEntry[]}
         */
        const mergePreCheckErrors = [];
        /**
         * @type {boolean}
         */
        let wasIncomingAList = false;

        /**
         * @type {Resource[]|Resource}
         */
        let incomingResources = Array.isArray(incomingObjects)
            ? incomingObjects.map(o => FhirResourceCreator.create(o))
            : FhirResourceCreator.create(incomingObjects);

        for (const validator of this.validators) {
            const {
                validatedObjects: validatedObjectsByValidator, preCheckErrors, wasAList
            } = await validator.validate({
                base_version,
                currentOperationName,
                incomingResources,
                resourceType,
                requestInfo
            });

            incomingResources = validatedObjectsByValidator;
            if (wasAList) {
                wasIncomingAList = true;
            }

            mergePreCheckErrors.push(...preCheckErrors);
        }

        return { mergePreCheckErrors, resourcesIncomingArray: incomingResources, wasIncomingAList };
    }
}

module.exports = {
    MergeValidator
};
