const {partialTextQueryBuilder} = require('../../../utils/querybuilder.util');
const {BaseFilter} = require('./baseFilter');

/**
 * @classdesc Filters by missing
 * https://www.hl7.org/fhir/search.html#modifiers
 */
class FilterByPartialText extends BaseFilter {
    /**
     * @param {string} field
     * @param {string} value
     * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>|import('mongodb').Filter<import('mongodb').DefaultSchema>[]}
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
