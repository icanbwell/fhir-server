/**
 * filters by uri
 * https://www.hl7.org/fhir/search.html#uri
 * @param {Object[]} and_segments
 * @param {import('../common/types').SearchParameterDefinition} propertyObj
 * @param {string | string[]} queryParameterValue
 * @param {Set} columns
 */
function filterByCanonical({and_segments, propertyObj, queryParameterValue, columns}) {
    and_segments.push({[`${propertyObj.field}`]: queryParameterValue});
    columns.add(`${propertyObj.field}`);
}

module.exports = {
    filterByCanonical
};
