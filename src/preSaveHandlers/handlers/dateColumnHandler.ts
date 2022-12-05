const {PreSaveHandler} = require('./preSaveHandler');
const {isColumnDateType} = require('../../operations/common/isColumnDateType');

class DateColumnHandler extends PreSaveHandler {
    async preSaveAsync({resource}) {
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
