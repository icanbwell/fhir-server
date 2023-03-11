const {partialTextQueryBuilder} = require('../../../utils/querybuilder.util');

/**
 * Filters by missing
 * https://www.hl7.org/fhir/search.html#modifiers
 * @param {ParsedArgsItem} parsedArg
 * @param {SearchParameterDefinition} propertyObj
 * @param {Set} columns
 * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>[]}
 */
function filterByPartialText({parsedArg, propertyObj, columns}) {
    /**
     * @type {string[]}
     */
    const queryParameterValues = parsedArg.queryParameterValue.values;
    /**
     * @type {Object[]}
     */
    const and_segments = [];
    // implement the modifier for partial text search
    // https://www.hl7.org/fhir/search.html#modifiers
    for (const queryParameterValue of queryParameterValues) {
        /**
         * @type {string}
         */
        const textToSearchFor = queryParameterValue;

        and_segments.push(
            {
                '$or': [
                    // 1. search in text field
                    partialTextQueryBuilder(
                        {
                            field: `${propertyObj.field}.text`,
                            partialText: textToSearchFor,
                            ignoreCase: true,
                        }
                    ),
                    // 2. search in display field for every coding
                    partialTextQueryBuilder(
                        {
                            field: `${propertyObj.field}.coding.display`,
                            partialText: textToSearchFor,
                            ignoreCase: true,
                        }
                    )
                ]
            },
        );
    }
    columns.add(`${propertyObj.field}`);
    return and_segments;
}

module.exports = {
    filterByPartialText
};
