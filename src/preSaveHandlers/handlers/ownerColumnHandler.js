const { PreSaveHandler } = require('./preSaveHandler');
const { SecurityTagSystem } = require('../../utils/securityTagSystem');
const { generateUUIDv5 } = require('../../utils/uid.util');
const { ConfigManager } = require('../../utils/configManager');
const { assertTypeEquals } = require('../../utils/assertType');

/**
 * @classdesc Adds the owner meta security tag if not present (by using first access tag)
 */
class OwnerColumnHandler extends PreSaveHandler {
    /**
     * constructor
     * @param {ConfigManager} configManager
     */
    constructor ({ configManager }) {
        super();

        assertTypeEquals(configManager, ConfigManager);
        /**
         * @type {Set<string>}
         */
        this.codingIdResourceTypes = new Set(configManager.preSaveCodingIdUpdateResources);
    }

    /**
     * fixes up any resources before they are saved
     * @typedef {Object} PreSaveAsyncProps
     * @property {Object} resource
     *
     * @param {PreSaveAsyncProps}
     * @returns {Promise<Object>}
     */
    async preSaveAsync ({ resource }) {
        if (resource.meta && resource.meta.security) {
            /**
             * @type {string[]}
             */
            const ownerCodes = resource.meta.security
                .filter(s => s.system === SecurityTagSystem.owner)
                .map(s => s.code);
            if (ownerCodes.length === 0) {
                /**
                 * @type {string[]}
                 */
                const accessCodes = resource.meta.security
                    .filter(s => s.system === SecurityTagSystem.access)
                    .map(s => s.code);
                if (accessCodes.length > 0) {
                    /**
                     * @type {string}
                     */
                    const firstAccessCode = accessCodes[0];
                    resource.meta.security.push(
                        this.buildOwnerTag(resource.resourceType, firstAccessCode)
                    );
                }
            }
        }

        return resource;
    }

    /**
     * Builds the owner security tag, adding a deterministic coding id only for
     * resource types configured in PRE_SAVE_CODING_ID_UPDATE_RESOURCES.
     * @param {string} resourceType
     * @param {string} code
     * @returns {{ id?: string, system: string, code: string }}
     */
    buildOwnerTag (resourceType, code) {
        const tag = {
            system: SecurityTagSystem.owner,
            code
        };
        if (this.codingIdResourceTypes.has(resourceType) || this.codingIdResourceTypes.has('Resource')) {
            tag.id = generateUUIDv5(`${SecurityTagSystem.owner}|${code}`);
        }
        return tag;
    }
}

module.exports = {
    OwnerColumnHandler
};
