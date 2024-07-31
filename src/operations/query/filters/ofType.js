const { BaseFilter } = require('./baseFilter');
const { tokenIdentifierOfTypeQueryBuilder } = require('../../../utils/querybuilder.util');

/**
 * filters by of-type
 * https://hl7.org/fhir/R4B/search.html#token
 */
class FilterByOfType extends BaseFilter {
    /**
     * @param {string} field
     * @param {string} value
     * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>|import('mongodb').Filter<import('mongodb').DefaultSchema>[]}
     */
    filterByItem(field, value) {
        if (this.propertyObj.type === 'token' && this.propertyObj.fieldType === 'Identifier') {
            return tokenIdentifierOfTypeQueryBuilder({
                target: value,
                field: this.fieldMapper.getFieldName(field)
            });
        } else {
            return {};
        }
    }
}

module.exports = {
    FilterByOfType
};
