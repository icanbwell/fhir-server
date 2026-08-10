const { PreSaveHandler } = require('./preSaveHandler');
const { SecurityTagSystem } = require('../../utils/securityTagSystem');

/**
 * @classdesc Adds the _access internal field from access tags to allow faster searching in Mongo
 */
class AccessColumnHandler extends PreSaveHandler {
    /**
     * fixes up any resources before they are saved
     * @typedef {Object} PreSaveAsyncProps
     * @property {import('../../fhir/classes/4_0_0/resources/resource')} resource
     *
     * @param {PreSaveAsyncProps}
     * @returns {Promise<import('../../fhir/classes/4_0_0/resources/resource')>}
     */
    async preSaveAsync ({ resource }) {
        // Only meta.security actually present as an array is authoritative about what the access
        // tags are. When it is absent/null we have no statement about access at all, so _access is
        // left alone rather than being wrongly emptied.
        if (resource.meta && Array.isArray(resource.meta.security)) {
            /**
             * @type {string[]}
             */
            const accessCodes = resource.meta.security.filter(s => s.system === SecurityTagSystem.access).map(s => s.code);
            // Remove any _access entries that no longer have a corresponding access tag. This runs
            // even when accessCodes is empty: previously it was nested inside `accessCodes.length > 0`,
            // so removing the LAST access tag (or every access tag) left the old _access codes behind
            // forever. _access is what the access-index query path filters on
            // ({'_access.<code>': 1}), so a stale entry keeps the resource readable by a tenant whose
            // access tag was revoked.
            if (resource._access) {
                for (const [tagName] of Object.entries(resource._access)) {
                    if (!accessCodes.includes(tagName)) {
                        delete resource._access[`${tagName}`];
                    }
                }
            }
            if (accessCodes.length > 0) {
                resource._access = resource._access || {};
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
