const {isTrue} = require('../../../utils/isTrue');

/**
 * Filters by missing
 * https://www.hl7.org/fhir/search.html#modifiers
 * @param {Object} args
 * @param {string} queryParameter
 * @param {Object[]} and_segments
 * @param {import('../common/types').SearchParameterDefinition} propertyObj
 * @param {Set} columns
 */
function filterByMissing(args, queryParameter, and_segments, propertyObj, columns) {
    // handle check for missing values
    const missing_flag = isTrue(args[`${queryParameter}:missing`]);
    if (missing_flag === true) {
        // https://www.mongodb.com/docs/manual/tutorial/query-for-null-fields/#equality-filter
        // if we are looking for resources where this is missing
        and_segments.push({
            [`${propertyObj.field}`]: null,
        });
    } else {
        // if we are looking for resources where this is NOT missing
        // http://docs.mongodb.org/manual/reference/operator/query/ne/
        and_segments.push({
            [`${propertyObj.field}`]: {$ne: null}
        });
    }
    columns.add(`${propertyObj.field}`);
}

module.exports = {
    filterByMissing: filterByMissing
};
