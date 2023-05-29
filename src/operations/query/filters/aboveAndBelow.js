const { isUuid } = require('../../../utils/uid.util');
const {BaseFilter} = require('./baseFilter');

const _uuidFieldName = '_uuid';

/**
 * @classdesc filters by above FHIR search parameters
 * https://www.hl7.org/fhir/search.html#modifiers
 * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>[]}
 */
class FilterByAbove extends BaseFilter {
    /**
     * @param {string} field
     * @param {string} value
     * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>|import('mongodb').Filter<import('mongodb').DefaultSchema>[]}
     */
    filterByItem(field, value) {
        if (field === 'id' && isUuid(value)) {
            return {
                [this.fieldMapper.getFieldName(_uuidFieldName)]: {
                    $gt: value,
                }
            };
        }
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
        if (field === 'id' && isUuid(value)) {
            return {
                [this.fieldMapper.getFieldName(_uuidFieldName)]: {
                    $lt: value,
                }
            };
        }
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
