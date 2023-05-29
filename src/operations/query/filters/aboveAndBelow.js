const { isUuid } = require('../../../utils/uid.util');
const {BaseFilter} = require('./baseFilter');
const {UUID_FIELD_NAME} = require('../../../constants');

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
                [this.fieldMapper.getFieldName(UUID_FIELD_NAME)]: {
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
                [this.fieldMapper.getFieldName(UUID_FIELD_NAME)]: {
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
