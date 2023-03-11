/**
 * filters by uri
 * https://www.hl7.org/fhir/search.html#uri
 * @param {SearchParameterDefinition} propertyObj
 * @param {ParsedArgsItem} parsedArg
 * @param {Set} columns
 * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>[]}
 */
function filterByUri({propertyObj, parsedArg, columns}) {
    /**
     * @type {string[]}
     */
    const queryParameterValues = parsedArg.queryParameterValue.values;
    /**
     * @type {Object[]}
     */
    const and_segments = [];
    for (const queryParameterValue of queryParameterValues) {
        and_segments.push({[`${propertyObj.field}`]: queryParameterValue});
    }
    columns.add(`${propertyObj.field}`);
    return and_segments;
}

module.exports = {
    filterByUri
};
