/**
 * Finds field in fields that has same name as name
 * @name {string[]} fields
 * @name {string} name
 * @returns {string}
 */
const {escapeRegExp} = require('../../../utils/regexEscaper');

/**
 * filters by contains
 * https://www.hl7.org/fhir/search.html#string
 * @param {Object[]} and_segments
 * @param {string} queryParameterValue
 * @param {Set} columns
 */
function filterByContains({and_segments, queryParameterValue, columns}) {
    and_segments.push({
        '$or': Array.from(columns).map(c => {
            return {
                [c]:
                    {
                        $regex: escapeRegExp(queryParameterValue),
                        $options: 'i',
                    },
            };
        })
    });
}

module.exports = {
    filterByContains: filterByContains
};
