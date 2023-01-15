/**
 * Filters by id
 * https://www.hl7.org/fhir/search.html#id
 * @param {string | string[]} queryParameterValue
 * @param {SearchParameterDefinition} propertyObj
 * @param {Set} columns
 * @return {Object[]}
 */
function filterById({queryParameterValue, propertyObj, columns}) {
    /**
     * @type {Object[]}
     */
    const and_segments = [];
    /**
     * @type {string}
     */
    const field = propertyObj.field;
    if (Array.isArray(queryParameterValue)) {
        // if array is passed then check in array
        and_segments.push({
            [`${field}`]: {
                $in: queryParameterValue,
            },
        });
    } else if (queryParameterValue.includes(',')) {
        // see if this is a comma separated list
        const value_list = queryParameterValue.split(',');
        and_segments.push({
            [`${field}`]: {
                $in: value_list,
            },
        });
    } else {
        // single value is passed
        and_segments.push({
            [`${field}`]: queryParameterValue,
        });
    }
    columns.add(`${field}`);
    return and_segments;
}

module.exports = {
    filterById
};
