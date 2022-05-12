const {isColumnDateType} = require('./isColumnDateType');
/**
 * fixes up any resources before they are saved
 * @param {Resource} resource
 * @returns {Promise<Resource>}
 */
const preSave = async function (resource) {
    for (const [fieldName, field] of Object.entries(resource)) {
        // if a column is of date type then set it to date (if not already)
        // TODO: this currently only handles one level deep fields.  Change it to handle fields multiple levels deep
        if (isColumnDateType(resource.resourceType, fieldName)) {
            if (!(resource[`${fieldName}`] instanceof Date)) {
                resource[`${fieldName}`] = new Date(field);
            }
        }
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
    }

    return resource;
};

module.exports = {
    preSave: preSave,
};
