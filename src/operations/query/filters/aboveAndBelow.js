/**
 * filters by above and below FHIR search parameters
 * https://www.hl7.org/fhir/search.html#modifiers
 * @param {Object[]} and_segments
 * @param {import('../common/types').SearchParameterDefinition} propertyObj
 * @param {Object} args
 * @param {string} queryParameter
 * @param {Set} columns
 */
function filterByAboveAndBelow({and_segments, propertyObj, args, queryParameter, columns}) {
    and_segments.push({
        [`${propertyObj.field}`]: {
            $gt: args[`${queryParameter}:above`],
            $lt: args[`${queryParameter}:below`],
        },
    });
    columns.add(`${propertyObj.field}`);
}

/**
 * filters by above FHIR search parameters
 * https://www.hl7.org/fhir/search.html#modifiers
 * @param {Object[]} and_segments
 * @param {import('../common/types').SearchParameterDefinition} propertyObj
 * @param {Object} args
 * @param {string} queryParameter
 * @param {Set} columns
 */
function filterByAbove(and_segments, propertyObj, args, queryParameter, columns) {
    // handle check for above the passed in  value
    and_segments.push({
        [`${propertyObj.field}`]: {$gt: args[`${queryParameter}:above`]},
    });
    columns.add(`${propertyObj.field}`);
}

/**
 * filters by below FHIR search parameters
 * https://www.hl7.org/fhir/search.html#modifiers
 * @param {Object[]} and_segments
 * @param {import('../common/types').SearchParameterDefinition} propertyObj
 * @param {Object} args
 * @param {string} queryParameter
 * @param {Set} columns
 */
function filterByBelow(and_segments, propertyObj, args, queryParameter, columns) {
    // handle check for below the passed in value
    and_segments.push({
        [`${propertyObj.field}`]: {$lt: args[`${queryParameter}:below`]},
    });
    columns.add(`${propertyObj.field}`);
}


module.exports = {
    filterByBelow: filterByBelow,
    filterByAbove: filterByAbove,
    filterByAboveAndBelow: filterByAboveAndBelow
};
