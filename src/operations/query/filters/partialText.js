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
function filterByPartialText({args, queryParameter, and_segments, propertyObj, columns}) {
    // implement the modifier for partial text search
    // https://www.hl7.org/fhir/search.html#modifiers
    /**
     * @type {string}
     */
    const textToSearchFor = args[`${queryParameter}:text`];
    and_segments.push(
        {
            '$or': [
                // 1. search in text field
                partialTextQueryBuilder(
                    `${propertyObj.field}.text`,
                    textToSearchFor,
                    true
                ),
                // 2. search in display field for every coding
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
