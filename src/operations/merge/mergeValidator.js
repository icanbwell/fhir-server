const {FhirResourceCreator} = require('../../fhir/fhirResourceCreator');

class MergeValidator {
    /**
     * @param {BaseValidator[]} validators
     */
    constructor({
                    validators
                }) {
        /**
         * @type {BaseValidator[]}
         */
        this.validators = validators;
    }

    /**
     * @param {string} base_version
     * @param {date} currentDate
     * @param {string} currentOperationName
     * @param {Object|Object[]} incomingObjects
     * @param {string|null} path
     * @param {string} requestId
     * @param {string} resourceType
     * @param {string|null} scope
     * @param {string|null} user
     * @returns {Promise<{mergePreCheckErrors: MergeResultEntry[], resourcesIncomingArray: Resource[], wasIncomingAList: boolean}>}
     */
    async validate({
                       base_version,
                       currentDate,
                       currentOperationName,
                       incomingObjects,
                       path,
                       requestId,
                       resourceType,
                       scope,
                       user
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
        let incomingResources = Array.isArray(incomingObjects) ?
            incomingObjects.map(o => FhirResourceCreator.create(o)) :
            FhirResourceCreator.create(incomingObjects);

        for (const validator of this.validators) {
            let {
                validatedObjectsByValidator, preCheckErrors, wasAList
            } = await validator.validate({
                base_version,
                currentDate,
                currentOperationName,
                incomingResources,
                path,
                requestId,
                resourceType,
                scope,
                user
            });

            incomingResources = validatedObjectsByValidator;
            if (wasAList) {
                wasIncomingAList = true;
            }

            mergePreCheckErrors.push(...preCheckErrors);
        }

        return {mergePreCheckErrors, resourcesIncomingArray: incomingResources, wasIncomingAList};
    }
}

module.exports = {
    MergeValidator
};
