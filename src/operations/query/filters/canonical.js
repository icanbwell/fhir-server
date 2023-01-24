/**
 * filters by canonical uri
 * https://www.hl7.org/fhir/search.html#uri
 * @param {SearchParameterDefinition} propertyObj
 * @param {string | string[]} queryParameterValue
 * @param {Set} columns
 * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>[]}
 */
function filterByCanonical({propertyObj, queryParameterValue, columns}) {
    /**
     * @type {Object[]}
     */
    const and_segments = [];
    // handle simple case without an OR to keep it simple
    if (propertyObj.fields && Array.isArray(propertyObj.fields)) {
        and_segments.push({
                $or: propertyObj.fields.map((field1) => {
                        return {
                            [`${field1}`]: queryParameterValue,
                        };
                    }
                ),
            },
        );
        // Adding properyobj fields to the columns set, to be used as index hints
        propertyObj.fields.forEach(columns.add, columns);
    } else {
        and_segments.push(
            {
                [`${propertyObj.field}`]: queryParameterValue,
            }
        );
        // Adding the field to columns set, to be used as index hints
        columns.add(`${propertyObj.field}`);
    }
    return and_segments;
}

module.exports = {
    filterByCanonical
};
