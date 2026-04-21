const { PreSaveHandler } = require('./preSaveHandler');
const Coding = require('../../fhir/classes/4_0_0/complex_types/coding');
const { SENSITIVE_CATEGORY } = require('../../constants');
const { generateUUIDv5 } = require('../../utils/uid.util');

/**
 * Adds a sensitivity-category tag to configured resource types on write
 */
class UnclassifiedSensitivityTagHandler extends PreSaveHandler {
    /**
     * @param {Object} params
     * @param {import('../../utils/configManager').ConfigManager} params.configManager
     */
    constructor ({ configManager }) {
        super();
        this.configManager = configManager;
    }

    /**
     * @param {Object} params
     * @param {import('../../fhir/classes/4_0_0/resources/resource')} params.resource
     * @param {import('../preSaveOptions').PreSaveOptions} [params.options]
     * @returns {Promise<import('../../fhir/classes/4_0_0/resources/resource')>}
     */
    async preSaveAsync ({ resource, options }) {
        if (!this.configManager.resourceTypesForUnclassifiedTagging.has(resource.resourceType)) {
            return resource;
        }
        if (!resource.meta || !resource.meta.security) {
            return resource;
        }

        const existingTag = resource.meta.security.find(
            s => s.system === SENSITIVE_CATEGORY.SYSTEM && s.code === SENSITIVE_CATEGORY.UNCLASSIFIED_CODE
        );

        if (existingTag) {
            if (!existingTag.id) {
                existingTag.id = generateUUIDv5(`${SENSITIVE_CATEGORY.SYSTEM}|${SENSITIVE_CATEGORY.UNCLASSIFIED_CODE}`);
            }
            return resource;
        }

        // suppressUnclassifiedTag skips tagging when called is not a user.
        if (options?.suppressUnclassifiedTag && !options.isUser) {
            return resource;
        }

        resource.meta.security.push(new Coding({
            id: generateUUIDv5(`${SENSITIVE_CATEGORY.SYSTEM}|${SENSITIVE_CATEGORY.UNCLASSIFIED_CODE}`),
            system: SENSITIVE_CATEGORY.SYSTEM,
            code: SENSITIVE_CATEGORY.UNCLASSIFIED_CODE
        }));

        return resource;
    }
}

module.exports = {
    UnclassifiedSensitivityTagHandler
};
