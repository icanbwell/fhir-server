const {isColumnDateType} = require('./isColumnDateType');
const {generateUUID} = require('../../utils/uid.util');

class PreSaveManager {
    /**
     * fixes up any resources before they are saved
     * @param {Resource} resource
     * @returns {Promise<Resource>}
     */
    async preSaveAsync(resource) {
        for (const [fieldName, field] of Object.entries(resource)) {
            // if a column is of date type then set it to date (if not already)
            // TODO: this currently only handles one level deep fields.  Change it to handle fields multiple levels deep
            if (isColumnDateType(resource.resourceType, fieldName)) {
                if (!(resource[`${fieldName}`] instanceof Date)) {
                    resource[`${fieldName}`] = new Date(field);
                }
            }
        }

        if (!resource._sourceId) {
            resource._sourceId = resource.id;
        }

        if (!resource._uuid) {
            resource._uuid = `urn:uuid:${generateUUID()}`;
        }

        if (resource.meta && resource.meta.security) {
            /**
             * @type {string[]}
             */
            const accessCodes = resource.meta.security.filter(s => s.system === 'https://www.icanbwell.com/access').map(s => s.code);
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
            /**
             * @type {string[]}
             */
            let sourceAssigningAuthorityCodes = resource.meta.security.filter(
                s => s.system === 'https://www.icanbwell.com/sourceAssigningAuthority').map(s => s.code);
            // if no sourceAssigningAuthorityCodes so fall back to owner tags
            if (sourceAssigningAuthorityCodes.length === 0) {
                sourceAssigningAuthorityCodes = resource.meta.security.filter(
                    s => s.system === 'https://www.icanbwell.com/owner').map(s => s.code);
            }
            if (sourceAssigningAuthorityCodes.length > 0) {
                resource._sourceAssigningAuthority = resource._sourceAssigningAuthority || {};
                // remove any tags that are don't have corresponding security tags
                for (const [tagName] of Object.entries(resource._sourceAssigningAuthority)) {
                    if (!sourceAssigningAuthorityCodes.includes(tagName)) {
                        delete resource._sourceAssigningAuthority[`${tagName}`];
                    }
                }
                // now add any new/updated tags
                for (const /** @type {string} **/ sourceAssigningAuthorityCode of sourceAssigningAuthorityCodes) {
                    if (resource._sourceAssigningAuthority[`${sourceAssigningAuthorityCode}`] !== 1) {
                        resource._sourceAssigningAuthority[`${sourceAssigningAuthorityCode}`] = 1;
                    }
                }
            }
        }

        return resource;
    }
}


module.exports = {
    PreSaveManager
};
