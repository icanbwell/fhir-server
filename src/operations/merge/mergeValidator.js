const { FhirResourceWriteSerializer } = require("../../fhir/fhirResourceWriteSerializer");
const { assertTypeEquals } = require("../../utils/assertType");
const { CustomTracer } = require('../../utils/customTracer');


class MergeValidator {
    /**
     * @param {BaseValidator[]} validators
     * @param {CustomTracer} customTracer
     */
    constructor ({ validators, customTracer }) {
        /**
         * @type {BaseValidator[]}
         */
        this.validators = validators;

        /**
         * @type {CustomTracer}
         */
        this.customTracer = customTracer;
        assertTypeEquals(customTracer, CustomTracer);
    }

    /**
     * @param {string} base_version
     * @param {Object|Object[]} incomingObjects
     * @param {string} resourceType
     * @param {FhirRequestInfo} requestInfo
     * @param {boolean} effectiveSmartMerge
     * @returns {Promise<{mergePreCheckErrors: MergeResultEntry[], resourcesIncomingArray: Resource[], wasIncomingAList: boolean}>}
     */
    async validateAsync ({
        base_version,
        incomingObjects,
        resourceType,
        requestInfo,
        effectiveSmartMerge
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
         * @type {Object[]|Object|Resource[]|Resource}
        */
        let incomingResources;

        incomingResources = incomingObjects;

        for (const validator of this.validators) {
            const {
                validatedObjects: validatedObjectsByValidator, preCheckErrors, wasAList
            } = await this.customTracer.trace({
                name: `MergeValidator.validate.${validator.constructor.name}`,
                func: async () => await validator.validate({
                    base_version,
                    incomingResources,
                    resourceType,
                    requestInfo,
                    effectiveSmartMerge
                })
            });

            incomingResources = validatedObjectsByValidator;
            if (wasAList) {
                wasIncomingAList = true;
            }

            mergePreCheckErrors.push(...preCheckErrors);
        }

        incomingResources = Array.isArray(incomingResources)
            ? incomingResources.map(o => FhirResourceWriteSerializer.serialize({obj: o}))
            : FhirResourceWriteSerializer.serialize({obj: incomingResources});

        return { mergePreCheckErrors, resourcesIncomingArray: incomingResources, wasIncomingAList };
    }
}

module.exports = {
    MergeValidator
};
