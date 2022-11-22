/**
 * filters by above and below FHIR search parameters
 * https://www.hl7.org/fhir/search.html#modifiers
 * @param {Object[]} and_segments
 * @param {string} aboveParameterValue
 * @param {string} belowParameterValue
 * @param {Set} columns
 */
function filterByAboveAndBelow({and_segments, aboveParameterValue, belowParameterValue, columns}) {
    and_segments.push({
        '$or': Array.from(columns).map(c => {
            return {
                [c]: {
                    $gt: aboveParameterValue,
                    $lt: belowParameterValue,
                },
            };
        })
    });
}

/**
 * filters by above FHIR search parameters
 * https://www.hl7.org/fhir/search.html#modifiers
 * @param {Object[]} and_segments
 * @param {string} queryParameterValue
 * @param {Set} columns
 */
function filterByAbove({and_segments, queryParameterValue, columns}) {
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
}

/**
 * filters by below FHIR search parameters
 * https://www.hl7.org/fhir/search.html#modifiers
 * @param {Object[]} and_segments
 * @param {string} queryParameterValue
 * @param {Set} columns
 */
function filterByBelow({and_segments, queryParameterValue, columns}) {
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
}

module.exports = {
    filterByBelow: filterByBelow,
    filterByAbove: filterByAbove,
    filterByAboveAndBelow: filterByAboveAndBelow
};
