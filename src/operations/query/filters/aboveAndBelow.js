/**
 * filters by above FHIR search parameters
 * https://www.hl7.org/fhir/search.html#modifiers
 * @param {SearchParameterDefinition} propertyObj
 * @param {string} queryParameterValue
 * @param {Set} columns
 * @return {Object[]}
 */
function filterByAbove({propertyObj, queryParameterValue, columns}) {
    /**
     * @type {Object[]}
     */
    const and_segments = [];
    // handle check for above the passed in  value
    and_segments.push({
        '$or': Array.from(columns).map(c => {
            return {
                [c]: {
                    $gt: queryParameterValue,
                },
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
 * @param {string} queryParameterValue
 * @param {Set} columns
 * @return {Object[]}
 */
function filterByBelow({propertyObj, queryParameterValue, columns}) {
    /**
     * @type {Object[]}
     */
    const and_segments = [];
    // handle check for below the passed in value
    and_segments.push({
        '$or': Array.from(columns).map(c => {
            return {
                [c]: {
                    lt: queryParameterValue,
                },
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
