const { PreSaveHandler } = require('./preSaveHandler');
const Coding = require('../../fhir/classes/4_0_0/complex_types/coding');
const { SENSITIVE_CATEGORY } = require('../../constants');
const { generateUUIDv5 } = require('../../utils/uid.util');

/**
 * Adds a sensitivity-category tag to configured resource types on write.
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
        if (!this.configManager.resourceTypesForUnclassifiedTagging.has(resource.resourceType) || options?.skipUnclassifiedTagging) {
            return resource;
        }
        if (!resource.meta || !resource.meta.security) {
            return resource;
        }

        const isUnclassified = (s) => s.system === SENSITIVE_CATEGORY.SYSTEM && s.code === SENSITIVE_CATEGORY.UNCLASSIFIED_CODE;
        const unclassifiedTags = resource.meta.security.filter(isUnclassified);
        const tagLength = unclassifiedTags.length;

        // dedup and normalize existing tags
        if (tagLength > 0) {
            const firstUnclassifiedTag = unclassifiedTags[0];
            firstUnclassifiedTag.id = generateUUIDv5(`${SENSITIVE_CATEGORY.SYSTEM}|${SENSITIVE_CATEGORY.UNCLASSIFIED_CODE}`);
            if (tagLength > 1) {
                resource.meta.security = resource.meta.security.filter(
                    s => !isUnclassified(s)
                );
                resource.meta.security.push(firstUnclassifiedTag);
            }
            return resource;
        }

        if (options?.suppressUnclassifiedTag) {
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
