const {BaseFilter} = require('./baseFilter');

/**
 * filters by canonical uri
 * https://www.hl7.org/fhir/search.html#uri
 */
class FilterByCanonical extends BaseFilter {
    /**
     * @param {string} field
     * @param {string} value
     * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>|import('mongodb').Filter<import('mongodb').DefaultSchema>[]}
     */
    filterByItem(field, value) {
        return {
            [this.fieldMapper.getFieldName(field)]: value
        };
    }
}

module.exports = {
    FilterByCanonical
};
