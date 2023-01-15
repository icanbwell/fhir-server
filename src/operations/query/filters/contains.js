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
 * @param {SearchParameterDefinition} propertyObj
 * @param {string} queryParameterValue
 * @param {Set} columns
 * @return {Object[]}
 */
function filterByContains({propertyObj, queryParameterValue, columns}) {
    /**
     * @type {Object[]}
     */
    const and_segments = [];
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
    columns.add(`${propertyObj.field}`);
    return and_segments;
}

module.exports = {
    filterByContains
};
