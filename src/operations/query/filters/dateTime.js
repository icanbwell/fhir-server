const {
    dateQueryBuilder,
    dateQueryBuilderNative,
    datetimePeriodQueryBuilder
} = require('../../../utils/querybuilder.util');
const {isColumnDateType} = require('../../common/isColumnDateType');
const {BaseFilter} = require('./baseFilter');

function isPeriodField(fieldString) {
    return fieldString === 'period' || fieldString === 'effectivePeriod';
}

/**
 * filters by date
 * https://www.hl7.org/fhir/search.html#date
 * @param {ParsedArgsItem} parsedArg
 * @param {SearchParameterDefinition} propertyObj
 * @param {string} resourceType
 * @param {Set} columns
 * @param {FieldMapper} fieldMapper
 * @returns {import('mongodb').Filter<import('mongodb').DefaultSchema>[]}
 */
class FilterByDateTime extends BaseFilter {
    /**
     * @param {string} field
     * @param {string} value
     * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>}
     */
    filterByItem(field, value) {
        // prettier-ignore
        const isDateSearchingPeriod = isPeriodField(field);
        if (isDateSearchingPeriod) {
            return datetimePeriodQueryBuilder(
                {
                    dateQueryItem: value,
                    fieldName: this.fieldMapper.getFieldName(field)
                }
            );
        } else if (
            this.propertyObj.field === 'meta.lastUpdated' ||
            isColumnDateType(this.resourceType, this.fieldMapper.getFieldName(field))
        ) {
            // if this of native Date type
            // this field stores the date as a native date, so we can do faster queries
            return {
                [this.fieldMapper.getFieldName(field)]: dateQueryBuilderNative(
                    {
                        dateSearchParameter: value,
                        type: this.propertyObj.type
                    }
                ),
            };
        } else {
            // if this is date as a string
            return {
                [this.fieldMapper.getFieldName(field)]: dateQueryBuilder({
                    date: value, type: this.propertyObj.type
                }),
            };
        }
    }
}

module.exports = {
    FilterByDateTime,
};
