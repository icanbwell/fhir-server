const {partialTextQueryBuilder} = require('../../../utils/querybuilder.util');
const {replaceOrWithNorIfNegation} = require('../../../utils/mongoNegator');

/**
 * Filters by missing
 * https://www.hl7.org/fhir/search.html#modifiers
 * @param {Object} args
 * @param {string} queryParameter
 * @param {import('../../common/types').SearchParameterDefinition} propertyObj
 * @param {Set} columns
 * @param {boolean} negation
 * @return {Object[]}
 */
function filterByPartialText({args, queryParameter, propertyObj, columns, negation}) {
    /**
     * @type {Object[]}
     */
    const and_segments = [];
    // implement the modifier for partial text search
    // https://www.hl7.org/fhir/search.html#modifiers
    /**
     * @type {string}
     */
    const textToSearchFor = args[`${queryParameter}:text`];

    and_segments.push(
        replaceOrWithNorIfNegation(
            {
                query: {
                    '$or': [
                        // 1. search in text field
                        partialTextQueryBuilder(
                            {
                                field: `${propertyObj.field}.text`,
                                partialText: textToSearchFor,
                                ignoreCase: true,
                                negation: false // the NOR above handles this
                            }
                        ),
                        // 2. search in display field for every coding
                        partialTextQueryBuilder(
                            {
                                field: `${propertyObj.field}.coding.display`,
                                partialText: textToSearchFor,
                                ignoreCase: true,
                                negation: false
                            }
                        )
                    ]
                },
                negation
            })
    );
    columns.add(`${propertyObj.field}`);
    return and_segments;
}

module.exports = {
    filterByPartialText
};
