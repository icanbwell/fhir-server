/**
 * filters by above FHIR search parameters
 * https://www.hl7.org/fhir/search.html#modifiers
 * @param {SearchParameterDefinition} propertyObj
 * @param {ParsedArgsItem} parsedArg
 * @param {Set} columns
 * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>[]}
 */
function filterByAbove({propertyObj, parsedArg, columns}) {
    /**
     * @type {string[]}
     */
    const queryParameterValues = parsedArg.queryParameterValue.values;
    /**
     * @type {Object[]}
     */
    const and_segments = [];
    // handle check for above the passed in  value
    and_segments.push({
        '$or': Array.from(columns).map(c => {
            return {
                $and: queryParameterValues.map(v => {
                        return {
                            [c]: {
                                $gt: v,
                            }
                        };
                    }
                )
            };
        })
    });
    columns.add(`${propertyObj.field}`);
    return and_segments;
}

/**
 * filters by below FHIR search parameters
 * https://www.hl7.org/fhir/search.html#modifiers
 * @param {import('../../common/types').SearchParameterDefinition} propertyObj
 * @param {ParsedArgsItem} parsedArg
 * @param {Set} columns
 * @return {Object[]}
 */
function filterByBelow({propertyObj, parsedArg, columns}) {
    /**
     * @type {string[]}
     */
    const queryParameterValues = parsedArg.queryParameterValue.values;
    /**
     * @type {Object[]}
     */
    const and_segments = [];
    // handle check for above the passed in  value
    and_segments.push({
        '$or': Array.from(columns).map(c => {
            return {
                $and: queryParameterValues.map(v => {
                        return {
                            [c]: {
                                $lt: v,
                            }
                        };
                    }
                )
            };
        })
    });
    columns.add(`${propertyObj.field}`);
    return and_segments;
}


module.exports = {
    filterByBelow,
    filterByAbove
};
