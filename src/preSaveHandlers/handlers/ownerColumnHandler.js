const { PreSaveHandler } = require('./preSaveHandler');
const { SecurityTagSystem } = require('../../utils/securityTagSystem');
const Coding = require('../../fhir/classes/4_0_0/complex_types/coding');

/**
 * @classdesc Adds the owner meta security tag if not present (by using first access tag)
 */
class OwnerColumnHandler extends PreSaveHandler {
    /**
     * fixes up any resources before they are saved
     * @param {string} base_version
     * @param {FhirRequestInfo} requestInfo
     * @param {Resource} resource
     * @returns {Promise<Resource>}
     */
    // eslint-disable-next-line no-unused-vars
    async preSaveAsync ({ base_version, requestInfo, resource }) {
        if (resource.meta && resource.meta.security) {
            /**
             * @type {string[]}
             */
            const ownerCodes = resource.meta.security.filter(
                s => s.system === SecurityTagSystem.owner).map(s => s.code);
            if (ownerCodes.length === 0) {
                /**
                 * @type {string[]}
                 */
                const accessCodes = resource.meta.security.filter(
                    s => s.system === SecurityTagSystem.access).map(s => s.code);
                if (accessCodes.length > 0) {
                    /**
                     * @type {string}
                     */
                    const firstAccessCode = accessCodes[0];
                    resource.meta.security.push(new Coding({
                        system: SecurityTagSystem.owner,
                        code: firstAccessCode
                    }));
                }
            }
        }

        return resource;
    }
}

module.exports = {
    OwnerColumnHandler
};
