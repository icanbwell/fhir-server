const { PreSaveHandler } = require('./preSaveHandler');
const { SecurityTagSystem } = require('../../utils/securityTagSystem');
const Coding = require('../../fhir/classes/4_0_0/complex_types/coding');
const { generateUUIDv5 } = require('../../utils/uid.util');
const Resource = require('../../fhir/classes/4_0_0/resources/resource');
const { ConfigManager } = require('../../utils/configManager');
const { assertTypeEquals } = require('../../utils/assertType');

/**
 * @classdesc If sourceAssigningAuthority meta tag is not present, this sets the first owner tag to be
 *              sourceAssigningAuthority tag.  Also adds the _sourceAssigningAuthority internal field to speed
 *              up searching in Mongo.
 */
class SourceAssigningAuthorityColumnHandler extends PreSaveHandler {
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
     * @property {import('../../fhir/classes/4_0_0/resources/resource')} resource
     *
     * @param {PreSaveAsyncProps}
     * @returns {Promise<import('../../fhir/classes/4_0_0/resources/resource')>}
     */
    async preSaveAsync ({ resource }) {
        if (resource.meta && resource.meta.security) {
            /**
             * @type {string[]}
             */
            let sourceAssigningAuthorityCodes = resource.meta.security.filter(
                s => s.system === SecurityTagSystem.sourceAssigningAuthority).map(s => s.code);
            // if no sourceAssigningAuthorityCodes so fall back to owner tags
            if (sourceAssigningAuthorityCodes.length === 0) {
                sourceAssigningAuthorityCodes = resource.meta.security
                    .filter(s => s.system === SecurityTagSystem.owner)
                    .map(s => s.code);
                sourceAssigningAuthorityCodes = Array.from(new Set(sourceAssigningAuthorityCodes));
                // add security tags
                if (sourceAssigningAuthorityCodes.length > 0) {
                    if (resource instanceof Resource) {
                        resource.meta.security.push(new Coding({
                            system: SecurityTagSystem.sourceAssigningAuthority,
                            code: sourceAssigningAuthorityCodes[0]
                        }));
                    } else {
                        resource.meta.security.push(
                            this.buildSourceAssigningAuthorityTag(resource.resourceType, sourceAssigningAuthorityCodes[0])
                        );
                    }
                }
            } else {
                sourceAssigningAuthorityCodes = Array.from(new Set(sourceAssigningAuthorityCodes));
            }
            if (sourceAssigningAuthorityCodes.length > 0) {
                const sourceAssigningAuthorityCode = sourceAssigningAuthorityCodes[0];
                if (resource._sourceAssigningAuthority !== sourceAssigningAuthorityCode) {
                    resource._sourceAssigningAuthority = sourceAssigningAuthorityCode;
                }
            }
        }

        return resource;
    }

    /**
     * Builds the sourceAssigningAuthority security tag for a plain object, stamping a deterministic
     * coding id only for resource types configured in PRE_SAVE_CODING_ID_UPDATE_RESOURCES.
     * @param {string} resourceType
     * @param {string} code
     * @returns {{ id?: string, system: string, code: string }}
     */
    buildSourceAssigningAuthorityTag (resourceType, code) {
        const tag = {
            system: SecurityTagSystem.sourceAssigningAuthority,
            code
        };
        if (this.codingIdResourceTypes.has(resourceType) || this.codingIdResourceTypes.has('Resource')) {
            tag.id = generateUUIDv5(`${SecurityTagSystem.sourceAssigningAuthority}|${code}`);
        }
        return tag;
    }
}

module.exports = {
    SourceAssigningAuthorityColumnHandler
};
