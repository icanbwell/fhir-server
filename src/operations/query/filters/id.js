const {negateEqualsIfNegation} = require('../../../utils/mongoNegator');

/**
 * Filters by id
 * https://www.hl7.org/fhir/search.html#id
 * @param {string | string[]} queryParameterValue
 * @param {import('../../common/types').SearchParameterDefinition} propertyObj
 * @param {Set} columns
 * @param {boolean} negation
 * @return {Object[]}
 */
function filterById({queryParameterValue, propertyObj, columns, negation}) {
    /**
     * @type {Object[]}
     */
    const and_segments = [];
    if (Array.isArray(queryParameterValue)) {
        // if array is passed then check in array
        and_segments.push({
            [`${propertyObj.field}`]: negation ?
                {
                    $nin: queryParameterValue,
                } :
                {
                    $in: queryParameterValue,
                },
        });
    } else if (queryParameterValue.includes(',')) {
        // see if this is a comma separated list
        const value_list = queryParameterValue.split(',');
        and_segments.push({
            [`${propertyObj.field}`]: negation ?
                {
                    $nin: value_list,
                } : {
                    $in: value_list,
                },
        });
    } else {
        // single value is passed
        and_segments.push({
            [`${propertyObj.field}`]: negateEqualsIfNegation({value: queryParameterValue, negation}),
        });
    }
    columns.add(`${propertyObj.field}`);
    return and_segments;
}

module.exports = {
    filterById
};
