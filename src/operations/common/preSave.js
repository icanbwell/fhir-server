const {isColumnDateType} = require('./isColumnDateType');
/**
 * fixes up any resources before they are saved
 * @param {Resource} resource
 * @returns {Promise<Resource>}
 */
const preSave = async function (resource) {
    for (const [fieldName, field] of Object.entries(resource)) {
        if (isColumnDateType(resource.resourceType, fieldName)) {
            resource[`${fieldName}`] = new Date(field);
        }
    }
    return resource;
};

module.exports = {
    preSave: preSave,
};
