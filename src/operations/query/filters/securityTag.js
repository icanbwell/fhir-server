const {tokenQueryBuilder} = require('../../../utils/querybuilder.util');
const {SecurityTagSystem} = require('../../../utils/securityTagSystem');
const {BaseFilter} = require('./baseFilter');
const {SystemValueParser} = require('../../../utils/systemValueParser');

/**
 * Filters by token
 * https://www.hl7.org/fhir/search.html#token
 */
class FilterBySecurityTag extends BaseFilter {
    /**
     * @param {string} field
     * @param {string} value
     * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>|import('mongodb').Filter<import('mongodb').DefaultSchema>[]}
     */
    filterByItem(field, value) {
        if (this.propertyObj.fieldFilter === '[system/@value=\'email\']') {
            return tokenQueryBuilder(
                {
                    target: value,
                    type: 'value',
                    field: this.fieldMapper.getFieldName(field),
                    required: 'email'
                }
            );
        } else if (this.propertyObj.fieldFilter === '[system/@value=\'phone\']') {
            return tokenQueryBuilder(
                {
                    target: value,
                    type: 'value',
                    field: this.fieldMapper.getFieldName(field),
                    required: 'phone'
                }
            );
        } else if (field === 'identifier') {
            // http://www.hl7.org/fhir/search.html#token
            return tokenQueryBuilder(
                {
                    target: value,
                    type: 'value',
                    field: this.fieldMapper.getFieldName(field),
                }
            );
        } else if (
            field === 'meta.security' ||
            field === 'meta.tag'
        ) {
            /**
             * @type {string}
             */
            const decodedTokenQueryItem = decodeURIComponent(value);
            const {system, value: value1} = SystemValueParser.parse(decodedTokenQueryItem);
            if (system) {
                if (system === SecurityTagSystem.access && this.fnUseAccessIndex(value1)) {
                    // http://www.hl7.org/fhir/search.html#token
                    return {[this.fieldMapper.getFieldName(`_access.${value1}`)]: 1};
                } else {
                    return tokenQueryBuilder(
                        {
                            target: value,
                            type: 'code',
                            field: this.fieldMapper.getFieldName(field)
                        }
                    );
                }
            } else {
                // http://www.hl7.org/fhir/search.html#token
                return tokenQueryBuilder(
                    {
                        target: value,
                        type: 'code',
                        field: this.fieldMapper.getFieldName(field)
                    }
                );
            }
        } else {
            return {
                $or: [
                    tokenQueryBuilder(
                        {
                            target: value,
                            type: 'code',
                            field: this.fieldMapper.getFieldName(field)
                        }
                    ),
                    tokenQueryBuilder(
                        {
                            target: value,
                            type: 'code',
                            field: this.fieldMapper.getFieldName(`${field}.coding`)
                        }
                    ),
                ],
            };
        }
    }
}

module.exports = {
    FilterBySecurityTag
};
