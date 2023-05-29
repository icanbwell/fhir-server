/**
 * Finds field in fields that has same name as name
 * @name {string[]} fields
 * @name {string} name
 * @returns {string}
 */
const {escapeRegExp} = require('../../../utils/regexEscaper');
const {BaseFilter} = require('./baseFilter');
const {
    tokenQueryContainsBuilder
} = require('../../../utils/querybuilder.util');
const { isUuid } = require('../../../utils/uid.util');

/**
 * filters by contains
 * https://www.hl7.org/fhir/search.html#string
 */
class FilterByContains extends BaseFilter {
    /**
     * @param {string} field
     * @param {string} value
     * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>|import('mongodb').Filter<import('mongodb').DefaultSchema>[]}
     */
    filterByItem(field, value) {
        if (this.propertyObj.type === 'token') {
            switch (this.propertyObj.fieldType) {
                // https://hl7.org/fhir/search.html#token
                case 'Coding':
                    return tokenQueryContainsBuilder(
                        {
                            target: value,
                            type: 'code',
                            field: this.fieldMapper.getFieldName(field)
                        }
                    );

                case 'CodeableConcept':
                    return tokenQueryContainsBuilder(
                        {
                            target: value,
                            type: 'code',
                            field: this.fieldMapper.getFieldName(`${field}.coding`)
                        }
                    );

                case 'Identifier':
                    return tokenQueryContainsBuilder(
                        {
                            target: value,
                            type: 'value',
                            field: this.fieldMapper.getFieldName(field)
                        }
                    );
            }
        }
        if (field === 'id' && isUuid(value)) {
            return this.filterByUuid(value);
        }
        // Not a token so process like a string
        return {
            [this.fieldMapper.getFieldName(field)]:
                {
                    $regex: escapeRegExp(value),
                    $options: 'i',
                }
        };
    }
}

module.exports = {
    FilterByContains
};
