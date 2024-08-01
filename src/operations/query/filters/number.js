const { numberQueryBuilder } = require('../../../utils/querybuilder.util');
const { BaseFilter } = require('./baseFilter');

/**
 * filters by number
 * https://www.hl7.org/fhir/search.html#number
 */
class FilterByNumber extends BaseFilter {
    /**
     * @param {string} field
     * @param {string} value
     * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>|import('mongodb').Filter<import('mongodb').DefaultSchema>[]}
     */
    filterByItem(field, value) {
        return numberQueryBuilder({ target: value, field });
    }
}

module.exports = {
    FilterByNumber
};
