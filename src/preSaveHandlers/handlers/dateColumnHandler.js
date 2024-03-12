const { PreSaveHandler } = require('./preSaveHandler');
const { isColumnDateType } = require('../../operations/common/isColumnDateType');

/**
 * @classdesc Converts date field from string to Date()
 */
class DateColumnHandler extends PreSaveHandler {
    /**
     * fixes up any resources before they are saved
     * @typedef {Object} PreSaveAsyncProps
     * @property {import('../../fhir/classes/4_0_0/resources/resource')} resource
     *
     * @param {PreSaveAsyncProps}
     * @returns {Promise<import('../../fhir/classes/4_0_0/resources/resource')>}
     */
    async preSaveAsync ({ resource }) {
        for (const [fieldName, field] of Object.entries(resource)) {
            // if a column is of date type then set it to date (if not already)
            // TODO: this currently only handles one level deep fields.  Change it to handle fields multiple levels deep
            if (isColumnDateType(resource.resourceType, fieldName)) {
                if (!(resource[`${fieldName}`] instanceof Date)) {
                    resource[`${fieldName}`] = new Date(field);
                }
            }
        }
        return resource;
    }
}

module.exports = {
    DateColumnHandler
};
