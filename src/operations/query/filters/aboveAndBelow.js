const {BaseFilter} = require('./baseFilter');

/**
 * @classdesc filters by above FHIR search parameters
 * https://www.hl7.org/fhir/search.html#modifiers
 * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>[]}
 */
class FilterByAbove extends BaseFilter {
    /**
     * @param {string} field
     * @param {string} value
     * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>}
     */
    filterByItem(field, value) {
        return {
            [this.fieldMapper.getFieldName(field)]: {
                $gt: value,
            }
        };
    }
}

/**
 * @classdesc filters by below FHIR search parameters
 * https://www.hl7.org/fhir/search.html#modifiers
 */
class FilterByBelow extends BaseFilter {
    /**
     * @param {string} field
     * @param {string} value
     * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>}
     */
    filterByItem(field, value) {
        return {
            [this.fieldMapper.getFieldName(field)]: {
                $lt: value,
            }
        };
    }
}

module.exports = {
    FilterByAbove,
    FilterByBelow
};
