const { PreSaveHandler } = require('./preSaveHandler');
const CodeableConcept = require("../../fhir/classes/4_0_0/complex_types/codeableConcept");
const { generateUUIDv5 } = require('../../utils/uid.util');
/**
 * @classdesc Converts date field from string to Date()
 */
class CodeableConceptIdHandler extends PreSaveHandler {
    /**
     * constructor
     */
    constructor () {
        super();
    }

    /**
     * fixes up any CodeableConcept fields in resources before they are saved
     * @typedef {Object} PreSaveAsyncProps
     * @property {import('../../fhir/classes/4_0_0/resources/resource')} resource
     *
     * @param {PreSaveAsyncProps}
     * @returns {Promise<import('../../fhir/classes/4_0_0/resources/resource')>}
     */
    async preSaveAsync ({ resource }) {
        await this.processResource(resource, '');
        return resource;
    }

    async processResource (resource) {
        this.updateIfNeeded(resource);
    }

    /**
     * Checks if resource needs to be updated if doesn't have id field
     * @param {import('../../fhir/classes/4_0_0/resources/resource')} resource
     * @returns {boolean}
     */
    updateIfNeeded (resource) {
        if (resource instanceof CodeableConcept && resource.coding) {
            for (const coding of resource.coding) {
                if (coding.system && coding.code && !coding.id) {
                    coding.id = generateUUIDv5(`${coding.system}|${coding.code}`);                }
            }
            return true;
        }

        let updated = false;

        if (resource instanceof Object || Array.isArray(resource)) {
            for (const /** @type {string} */ key in resource) {
                if ((
                        resource[`${key}`] instanceof Object ||
                        Array.isArray(resource[`${key}`])
                    ) &&
                    this.updateIfNeeded(resource[`${key}`])
                ) {
                    updated = true;
                   // break;
                }
            }
        }
        return updated;
    }
}

module.exports = {
    CodeableConceptIdHandler
};
