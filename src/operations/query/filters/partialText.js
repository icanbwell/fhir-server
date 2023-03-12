const {partialTextQueryBuilder} = require('../../../utils/querybuilder.util');
const {BaseFilter} = require('./baseFilter');

/**
 * Filters by missing
 * https://www.hl7.org/fhir/search.html#modifiers
 * @param {ParsedArgsItem} parsedArg
 * @param {SearchParameterDefinition} propertyObj
 * @param {Set} columns
 * @param {FieldMapper} fieldMapper
 * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>[]}
 */
class FilterByPartialText extends BaseFilter {
    /**
     * @param {string} field
     * @param {string} value
     * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>}
     */
    filterByItem(field, value) {
        return {
            '$or': [
                // 1. search in text field
                partialTextQueryBuilder(
                    {
                        field: this.fieldMapper.getFieldName(`${field}.text`),
                        partialText: value,
                        ignoreCase: true,
                    }
                ),
                // 2. search in display field for every coding
                partialTextQueryBuilder(
                    {
                        field: this.fieldMapper.getFieldName(`${field}.coding.display`),
                        partialText: value,
                        ignoreCase: true,
                    }
                )
            ]
        };
    }
}


module.exports = {
    FilterByPartialText
};
