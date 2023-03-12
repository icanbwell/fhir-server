const {searchParameterQueries} = require('./searchParameters');

/**
 * Returns the field in resource corresponding to search parameter
 * @param {string} searchResourceType
 * @param {string} searchParameterName
 * @returns {string | null}
 */
function getFieldNameForSearchParameter(searchResourceType, searchParameterName) {
    for (const [resourceType, resourceObj] of Object.entries(searchParameterQueries)) {
        if (resourceType === searchResourceType || resourceType === 'Resource') {
            for (const [queryParameter, propertyObj] of Object.entries(resourceObj)) {
                if (queryParameter === searchParameterName) {
                    return propertyObj.fields.length > 0 ? propertyObj.fields[0] : null;
                }
            }
        }
    }
    return null;
}

module.exports = {
    getFieldNameForSearchParameter: getFieldNameForSearchParameter,
};
