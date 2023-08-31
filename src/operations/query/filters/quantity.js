const {
    quantityQueryBuilder
} = require('../../../utils/querybuilder.util');
const {BaseFilter} = require('./baseFilter');

/**
 * filters by quantity
 * https://www.hl7.org/fhir/search.html#quantity
 */
class FilterByQuantity extends BaseFilter {
    /**
     * @param {string} field
     * @param {string} value
     * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>|import('mongodb').Filter<import('mongodb').DefaultSchema>[]}
     */
    filterByItem(field, value) {
        return quantityQueryBuilder({target: value, field});
    }
}

module.exports = {
    FilterByQuantity
};
