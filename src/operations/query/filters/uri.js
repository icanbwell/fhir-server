/**
 * filters by uri
 * https://www.hl7.org/fhir/search.html#uri
 * @param {SearchParameterDefinition} propertyObj
 * @param {string | string[]} queryParameterValue
 * @param {Set} columns
 * @return {Object[]}
 */
function filterByUri({propertyObj, queryParameterValue, columns}) {
    /**
     * @type {Object[]}
     */
    const and_segments = [];
    and_segments.push({[`${propertyObj.field}`]: queryParameterValue});
    columns.add(`${propertyObj.field}`);
    return and_segments;
}

module.exports = {
    filterByUri
};
