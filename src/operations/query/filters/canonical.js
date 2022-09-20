/**
 * filters by canonical uri
 * https://www.hl7.org/fhir/search.html#uri
 * @param {Object[]} and_segments
 * @param {import('../common/types').SearchParameterDefinition} propertyObj
 * @param {string | string[]} queryParameterValue
 * @param {Set} columns
 */
function filterByCanonical({and_segments, propertyObj, queryParameterValue, columns}) {
    // handle simple case without an OR to keep it simple
    if (propertyObj.fields && Array.isArray(propertyObj.fields)) {
        and_segments.push({
            $or: propertyObj.fields.map((field1) => {
                    return {
                        [`${field1}`]: queryParameterValue,
                    };
                }
            ),
        });
    } else {
        and_segments.push(
            {
                [`${propertyObj.field}`]: queryParameterValue,
            }
        );
    }
    columns.add(propertyObj.fields ? `${propertyObj.fields}` : `${propertyObj.field}`);
}

module.exports = {
    filterByCanonical
};
