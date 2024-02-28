const { PreSaveHandler } = require('./preSaveHandler');
const { SecurityTagSystem } = require('../../utils/securityTagSystem');

/**
 * @classdesc Adds the _access internal field from access tags to allow faster searching in Mongo
 */
class AccessColumnHandler extends PreSaveHandler {
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
            const accessCodes = resource.meta.security.filter(s => s.system === SecurityTagSystem.access).map(s => s.code);
            if (accessCodes.length > 0) {
                resource._access = resource._access || {};
                // remove any tags that are don't have corresponding security tags
                for (const [tagName] of Object.entries(resource._access)) {
                    if (!accessCodes.includes(tagName)) {
                        delete resource._access[`${tagName}`];
                    }
                }
                // now add any new/updated tags
                for (const /** @type {string} **/ accessCode of accessCodes) {
                    if (resource._access[`${accessCode}`] !== 1) {
                        resource._access[`${accessCode}`] = 1;
                    }
                }
            }
        }
        return resource;
    }
}

module.exports = {
    AccessColumnHandler
};
