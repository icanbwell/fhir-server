const {partialTextQueryBuilder} = require('../../../utils/querybuilder.util');

/**
 * Filters by missing
 * https://www.hl7.org/fhir/search.html#modifiers
 * @param {Object} args
 * @param {string} queryParameter
 * @param {Object[]} and_segments
 * @param {import('../common/types').SearchParameterDefinition} propertyObj
 * @param {Set} columns
 */
function filterByPartialText(args, queryParameter, and_segments, propertyObj, columns) {
    /**
     * @type {string}
     */
    const textToSearchFor = args[`${queryParameter}:text`];
    and_segments.push(
        {
            '$or': [
                partialTextQueryBuilder(
                    `${propertyObj.field}.text`,
                    textToSearchFor,
                    true
                ),
                partialTextQueryBuilder(
                    `${propertyObj.field}.coding.display`,
                    textToSearchFor,
                    true
                )
            ]
        }
    );
    columns.add(`${propertyObj.field}`);
}

module.exports = {
    filterByPartialText: filterByPartialText
};
