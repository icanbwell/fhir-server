/**
 * Filters by id
 * https://www.hl7.org/fhir/search.html#id
 * @param {string | string[]} queryParameterValue
 * @param {Object[]} and_segments
 * @param {import('../common/types').SearchParameterDefinition} propertyObj
 * @param {Set} columns
 */
function filterById(queryParameterValue, and_segments, propertyObj, columns) {
    if (Array.isArray(queryParameterValue)) {
        // if array is passed then check in array
        and_segments.push({
            [`${propertyObj.field}`]: {
                $in: queryParameterValue,
            },
        });
    } else if (queryParameterValue.includes(',')) {
        // see if this is a comma separated list
        const value_list = queryParameterValue.split(',');
        and_segments.push({
            [`${propertyObj.field}`]: {
                $in: value_list,
            },
        });
    } else {
        // single value is passed
        and_segments.push({
            [`${propertyObj.field}`]: queryParameterValue,
        });
    }
    columns.add(`${propertyObj.field}`);
}

module.exports = {
    filterById: filterById
};
