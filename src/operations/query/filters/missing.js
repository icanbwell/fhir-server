const {isTrue} = require('../../../utils/isTrue');
const {BaseFilter} = require('./baseFilter');

/**
 * Filters by missing
 * https://www.hl7.org/fhir/search.html#modifiers
 * @param {Object} args
 * @param {ParsedArgsItem} parsedArg
 * @param {SearchParameterDefinition} propertyObj
 * @param {Set} columns
 * @param {FieldMapper} fieldMapper
 * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>[]}
 */
class FilterByMissing extends BaseFilter {
    /**
     * @param {string} field
     * @param {string} value
     * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>}
     */
    filterByItem(field, value) {
        return isTrue(value) ?
            {
                [this.fieldMapper.getFieldName(field)]: null
            } :
            {
                [this.fieldMapper.getFieldName(field)]: {$ne: null}
            };
    }
}

module.exports = {
    FilterByMissing
};
