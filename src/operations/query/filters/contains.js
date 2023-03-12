/**
 * Finds field in fields that has same name as name
 * @name {string[]} fields
 * @name {string} name
 * @returns {string}
 */
const {escapeRegExp} = require('../../../utils/regexEscaper');
const {BaseFilter} = require('./baseFilter');

/**
 * filters by contains
 * https://www.hl7.org/fhir/search.html#string
 */
class FilterByContains extends BaseFilter {
    /**
     * @param {string} field
     * @param {string} value
     * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>}
     */
    filterByItem(field, value) {
        return {
            [this.fieldMapper.getFieldName(field)]:
                {
                    $regex: escapeRegExp(value),
                    $options: 'i',
                }
        };
    }
}

module.exports = {
    FilterByContains
};
