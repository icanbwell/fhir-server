const deepcopy = require("deepcopy");
const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');
const { FhirResourceWriteSerializer } = require("../../fhir/fhirResourceWriteSerializer");
const { ConfigManager } = require("../../utils/configManager");
const { assertTypeEquals } = require("../../utils/assertType");


class MergeValidator {
    /**
     * @param {BaseValidator[]} validators
     * @param {ConfigManager} configManager
     */
    constructor ({ validators, configManager }) {
        /**
         * @type {BaseValidator[]}
         */
        this.validators = validators;

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
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

        if (this.configManager.enableMergeFastSerializer) {
            // copy incoming objects to avoid mutation of data for access logs
            incomingResources = deepcopy(incomingObjects);

            if (!this.configManager.updateMergeValidations) {
                incomingResources = Array.isArray(incomingResources)
                    ? incomingResources.map(o => FhirResourceWriteSerializer.serialize({obj: o}))
                    : FhirResourceWriteSerializer.serialize({obj: incomingResources});
            }
        } else {
            incomingResources = Array.isArray(incomingObjects)
            ? incomingObjects.map(o => FhirResourceCreator.create(o))
            : FhirResourceCreator.create(incomingObjects);
        }

        for (const validator of this.validators) {
            const {
                validatedObjects: validatedObjectsByValidator, preCheckErrors, wasAList
            } = await validator.validate({
                base_version,
                incomingResources,
                resourceType,
                requestInfo,
                effectiveSmartMerge
            });

            incomingResources = validatedObjectsByValidator;
            if (wasAList) {
                wasIncomingAList = true;
            }

            mergePreCheckErrors.push(...preCheckErrors);
        }

        if (this.configManager.updateMergeValidations) {
            incomingResources = Array.isArray(incomingResources)
                ? incomingResources.map(o => FhirResourceWriteSerializer.serialize({obj: o}))
                : FhirResourceWriteSerializer.serialize({obj: incomingResources});
        }

        return { mergePreCheckErrors, resourcesIncomingArray: incomingResources, wasIncomingAList };
    }
}

module.exports = {
    MergeValidator
};
