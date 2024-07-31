const { nameQueryBuilder, addressQueryBuilder, stringQueryBuilder } = require('../../../utils/querybuilder.util');
const { BaseFilter } = require('./baseFilter');

/**
 * Filters by string
 * https://www.hl7.org/fhir/search.html#string
 */
class FilterByString extends BaseFilter {
    /**
     * @param {string} field
     * @param {string} value
     * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>|import('mongodb').Filter<import('mongodb').DefaultSchema>[]}
     */
    filterByItem (field, value) {
        const useExactSearch = this.parsedArg.modifiers.includes("exact");
        // If the field type is HumanName, use name query builder to apply the search in all the HumanName attributes.
        if (this.propertyObj && this.propertyObj.fieldType && this.propertyObj.fieldType.toLowerCase() === 'humanname') {
            const ors = nameQueryBuilder({ target: value, useExactSearch: useExactSearch });
            return { $or: ors };
        } else if (this.propertyObj && this.propertyObj.fieldType && this.propertyObj.fieldType.toLowerCase() === 'address') {
            // If the field is address, use address query builder to apply the search in all address attributes
            const ors = addressQueryBuilder({ target: value, useExactSearch: useExactSearch });
            return { $or: ors };
        } else {
            return useExactSearch ? { [this.fieldMapper.getFieldName(field)]: value } : { [`${this.fieldMapper.getFieldName(field)}`]: stringQueryBuilder({ target: value }) };
        }
    }
}

module.exports = {
    FilterByString
};
