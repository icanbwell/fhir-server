const {isTrue} = require('../../../utils/isTrue');

/**
 * Filters by missing
 * https://www.hl7.org/fhir/search.html#modifiers
 * @param {Object[]} and_segments
 * @param {string} queryParameterValue
 * @param {Set} columns
 */
function filterByMissing({and_segments, queryParameterValue, columns}) {
    // handle check for missing values
    const missing_flag = isTrue(queryParameterValue);

    and_segments.push({
        '$or': Array.from(columns).map(c => {
            if (missing_flag === true) {
                // https://www.mongodb.com/docs/manual/tutorial/query-for-null-fields/#equality-filter
                // if we are looking for resources where this is missing
                return {[c]: null};
            } else {
                // if we are looking for resources where this is NOT missing
                // http://docs.mongodb.org/manual/reference/operator/query/ne/
                return {[c]: {$ne: null}};
            }
        })
    });
}

module.exports = {
    filterByMissing: filterByMissing
};
