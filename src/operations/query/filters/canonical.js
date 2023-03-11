const {getIndexHints} = require('../../common/getIndexHints');

/**
 * filters by canonical uri
 * https://www.hl7.org/fhir/search.html#uri
 * @param {SearchParameterDefinition} propertyObj
 * @param {ParsedArgsItem} parsedArg
 * @param {Set} columns
 * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>[]}
 */
function filterByCanonical({propertyObj, parsedArg, columns}) {
    /**
     * @type {string[]}
     */
    const queryParameterValues = parsedArg.queryParameterValue.values;
    /**
     * @type {Object[]}
     */
    const and_segments = [];
    // handle simple case without an OR to keep it simple
    if (propertyObj.fields && Array.isArray(propertyObj.fields)) {
        and_segments.push({
                $or: propertyObj.fields.map((field1) => {
                        return {
                            $and: queryParameterValues.map(v => {
                                return {
                                    [`${field1}`]: v,
                                };
                            })
                        };
                    }
                ),
            },
        );
    } else {
        and_segments.push(
            {
                $and: queryParameterValues.map(v => {
                    return {
                        [`${propertyObj.field}`]: v
                    };
                }),
            }
        );
        // Adding the field to columns set, to be used as index hints
    }
    getIndexHints(columns, propertyObj);
    return and_segments;
}

module.exports = {
    filterByCanonical
};
