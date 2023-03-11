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
 * @param {ParsedArgsItem} parsedArg
 * @param {Set} columns
 * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>[]}
 */
function filterByContains({propertyObj, parsedArg, columns}) {
    /**
     * @type {string[]}
     */
    const queryParameterValues = parsedArg.queryParameterValue.values;
    /**
     * @type {Object[]}
     */
    const and_segments = [];
    and_segments.push({
        '$or': Array.from(columns).map(c => {
            return {
                $and: queryParameterValues.map(v => {
                        return {
                            [c]:
                                {
                                    $regex: escapeRegExp(v),
                                    $options: 'i',
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
    filterByContains
};
