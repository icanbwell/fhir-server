const {isTrue} = require('../../../utils/isTrue');

/**
 * Filters by missing
 * https://www.hl7.org/fhir/search.html#modifiers
 * @param {Object} args
 * @param {string} queryParameterValue
 * @param {SearchParameterDefinition} propertyObj
 * @param {Set} columns
 * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>[]}
 */
function filterByMissing({queryParameterValue, propertyObj, columns}) {
    /**
     * @type {Object[]}
     */
    const and_segments = [];
    // handle check for missing values
    const missing_flag = isTrue(queryParameterValue);
    if (missing_flag === true) {
        // https://www.mongodb.com/docs/manual/tutorial/query-for-null-fields/#equality-filter
        // if we are looking for resources where this is missing
        and_segments.push({
            [`${propertyObj.field}`]: null,
        });
    } else {
        // if we are looking for resources where this is NOT missing
        // http://docs.mongodb.org/manual/reference/operator/query/ne/
        and_segments.push({
            [`${propertyObj.field}`]: {$ne: null}
        });
    }
    columns.add(`${propertyObj.field}`);
    return and_segments;
}

module.exports = {
    filterByMissing
};
