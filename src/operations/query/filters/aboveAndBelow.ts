/**
 * filters by above and below FHIR search parameters
 * https://www.hl7.org/fhir/search.html#modifiers
 * @param {import('../../common/types').SearchParameterDefinition} propertyObj
 * @param {Object} args
 * @param {string} queryParameter
 * @param {Set} columns
 * @return {Object[]}
 */
function filterByAboveAndBelow({propertyObj, args, queryParameter, columns}) {
    /**
     * @type {Object[]}
     */
    const and_segments = [];
    and_segments.push({
        [`${propertyObj.field}`]: {
            $gt: args[`${queryParameter}:above`],
            $lt: args[`${queryParameter}:below`],
        },
    });
    columns.add(`${propertyObj.field}`);
    return and_segments;
}

/**
 * filters by above FHIR search parameters
 * https://www.hl7.org/fhir/search.html#modifiers
 * @param {import('../../common/types').SearchParameterDefinition} propertyObj
 * @param {Object} args
 * @param {string} queryParameter
 * @param {Set} columns
 * @return {Object[]}
 */
function filterByAbove({propertyObj, args, queryParameter, columns}) {
    /**
     * @type {Object[]}
     */
    const and_segments = [];
    // handle check for above the passed in  value
    and_segments.push({
        [`${propertyObj.field}`]: {$gt: args[`${queryParameter}:above`]},
    });
    columns.add(`${propertyObj.field}`);
    return and_segments;
}

/**
 * filters by below FHIR search parameters
 * https://www.hl7.org/fhir/search.html#modifiers
 * @param {import('../../common/types').SearchParameterDefinition} propertyObj
 * @param {Object} args
 * @param {string} queryParameter
 * @param {Set} columns
 * @return {Object[]}
 */
function filterByBelow({propertyObj, args, queryParameter, columns}) {
    /**
     * @type {Object[]}
     */
    const and_segments = [];
    // handle check for below the passed in value
    and_segments.push({
        [`${propertyObj.field}`]: {$lt: args[`${queryParameter}:below`]},
    });
    columns.add(`${propertyObj.field}`);
    return and_segments;
}


module.exports = {
    filterByBelow,
    filterByAbove,
    filterByAboveAndBelow
};
