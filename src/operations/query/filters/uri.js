const {negateEqualsIfNegation} = require('../../../utils/mongoNegator');

/**
 * filters by uri
 * https://www.hl7.org/fhir/search.html#uri
 * @param {import('../../common/types').SearchParameterDefinition} propertyObj
 * @param {string | string[]} queryParameterValue
 * @param {Set} columns
 * @param {boolean} negation
 * @return {Object[]}
 */
function filterByUri({propertyObj, queryParameterValue, columns, negation}) {
    /**
     * @type {Object[]}
     */
    const and_segments = [];
    and_segments.push(
        {
            [`${propertyObj.field}`]: negateEqualsIfNegation({value: queryParameterValue, negation})
        }
    );
    columns.add(`${propertyObj.field}`);
    return and_segments;
}

module.exports = {
    filterByUri
};
