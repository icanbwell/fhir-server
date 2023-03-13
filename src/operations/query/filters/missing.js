const {isTrue} = require('../../../utils/isTrue');
const {BaseFilter} = require('./baseFilter');

/**
 * Filters by missing
 * https://www.hl7.org/fhir/search.html#modifiers
 */
class FilterByMissing extends BaseFilter {
    /**
     * @param {string} field
     * @param {string} value
     * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>|import('mongodb').Filter<import('mongodb').DefaultSchema>[]}
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
