const {tokenQueryBuilder, exactMatchQueryBuilder} = require('../../../utils/querybuilder.util');
const {BaseFilter} = require('./baseFilter');

/**
 * Filters by token
 * https://www.hl7.org/fhir/search.html#token
 */
class FilterByToken extends BaseFilter {
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
                    required: 'email',
                    resourceType: this.resourceType
                }
            );
        } else if (this.propertyObj.fieldFilter === '[system/@value=\'phone\']') {
            return tokenQueryBuilder(
                {
                    target: value,
                    type: 'value',
                    field: this.fieldMapper.getFieldName(field),
                    required: 'phone',
                    resourceType: this.resourceType
                }
            );
        } else if (field === 'identifier') {
            // http://www.hl7.org/fhir/search.html#token
            return tokenQueryBuilder(
                {
                    target: value,
                    type: 'value',
                    field: this.fieldMapper.getFieldName(field),
                    resourceType: this.resourceType
                }
            );
        } else if (
            field === 'meta.security' ||
            field === 'meta.tag'
        ) {
            // http://www.hl7.org/fhir/search.html#token
            return tokenQueryBuilder(
                {
                    target: value,
                    type: 'code',
                    field: this.fieldMapper.getFieldName(field),
                    resourceType: this.resourceType
                }
            );
        } else {
            switch (this.propertyObj.fieldType) {
                // https://hl7.org/fhir/search.html#token
                case 'Coding':
                    return tokenQueryBuilder(
                        {
                            target: value,
                            type: 'code',
                            field: this.fieldMapper.getFieldName(field),
                            resourceType: this.resourceType
                        }
                    );

                case 'CodeableConcept':
                    return tokenQueryBuilder(
                        {
                            target: value,
                            type: 'code',
                            field: this.fieldMapper.getFieldName(`${field}.coding`),
                            resourceType: this.resourceType
                        }
                    );

                case 'Identifier':
                    return tokenQueryBuilder(
                        {
                            target: value,
                            type: 'value',
                            field: this.fieldMapper.getFieldName(field),
                            resourceType: this.resourceType
                        }
                    );

                case 'ContactPoint':
                    return exactMatchQueryBuilder(
                        {
                            target: value,
                            field: this.fieldMapper.getFieldName(`${field}.value`)
                        }
                    );

                case 'boolean':
                    return exactMatchQueryBuilder(
                        {
                            target: value === 'true' ? true : false,
                            field: this.fieldMapper.getFieldName(field)
                        }
                    );

                case 'code':
                case 'uri':
                case 'string':
                    return exactMatchQueryBuilder(
                        {
                            target: value,
                            field: this.fieldMapper.getFieldName(field)
                        }
                    );

                default:
                    // can't detect type so use multiple methods
                    return {
                        $or: [
                            exactMatchQueryBuilder(
                                {
                                    target: value,
                                    field: this.fieldMapper.getFieldName(field)
                                }
                            ),
                            tokenQueryBuilder(
                                {
                                    target: value,
                                    type: 'code',
                                    field: this.fieldMapper.getFieldName(field),
                                    resourceType: this.resourceType
                                }
                            ),
                            tokenQueryBuilder(
                                {
                                    target: value,
                                    type: 'code',
                                    field: this.fieldMapper.getFieldName(`${field}.coding`),
                                    resourceType: this.resourceType
                                }
                            )
                        ]
                    };
            }
        }
    }
}

module.exports = {
    FilterByToken
};
