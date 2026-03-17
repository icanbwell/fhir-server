const deepcopy = require("deepcopy");
const { FhirResourceWriteSerializer } = require("../../fhir/fhirResourceWriteSerializer");


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
     * @returns {Promise<{mergePreCheckErrors: MergeResultEntry[], resourcesIncomingArray: Object[], wasIncomingAList: boolean}>}
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

        // copy incoming objects to avoid mutation of data for access logs
        /**
         * @type {Object[]|Object}
         */
        let incomingResources = deepcopy(incomingObjects);

        incomingResources = Array.isArray(incomingResources)
            ? incomingResources.map(o => FhirResourceWriteSerializer.serialize({obj: o}))
            : FhirResourceWriteSerializer.serialize({obj: incomingResources});

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
