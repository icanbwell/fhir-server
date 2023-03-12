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
     * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>}
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
            // columns.add(`${propertyObj.field}.system`);
            // columns.add(`${propertyObj.field}.value`);
        } else if (this.propertyObj.fieldFilter === '[system/@value=\'phone\']') {
            return tokenQueryBuilder(
                {
                    target: value,
                    type: 'value',
                    field: this.fieldMapper.getFieldName(field),
                    required: 'phone'
                }
            );
            // columns.add(`${propertyObj.field}.system`);
            // columns.add(`${propertyObj.field}.value`);
        } else if (this.propertyObj.field === 'identifier') {
            // http://www.hl7.org/fhir/search.html#token
            return tokenQueryBuilder(
                {
                    target: value,
                    type: 'value',
                    field: this.fieldMapper.getFieldName(field)
                }
            );
            // columns.add(`${propertyObj.field}.system`);
            // columns.add(`${propertyObj.field}.value`);
        } else if (
            this.propertyObj.field === 'meta.security' ||
            this.propertyObj.field === 'meta.tag'
        ) {
            // http://www.hl7.org/fhir/search.html#token
            return tokenQueryBuilder(
                {
                    target: value,
                    type: 'code',
                    field: this.fieldMapper.getFieldName(field)
                }
            );
            // columns.add(`${propertyObj.field}.system`);
            // columns.add(`${propertyObj.field}.code`);
        } else {
            switch (this.propertyObj.fieldType) {
                // https://hl7.org/fhir/search.html#token
                case 'Coding':
                    return tokenQueryBuilder(
                        {
                            target: value,
                            type: 'code',
                            field: this.fieldMapper.getFieldName(field)
                        }
                    );
                // columns.add(`${propertyObj.field}.system`);
                // columns.add(`${propertyObj.field}.code`);

                case 'CodeableConcept':
                    return tokenQueryBuilder(
                        {
                            target: value,
                            type: 'code',
                            field: this.fieldMapper.getFieldName(`${field}.coding`)
                        }
                    );
                // columns.add(`${propertyObj.field}.coding.system`);
                // columns.add(`${propertyObj.field}.coding.code`);
                // break;

                case 'Identifier':
                    return tokenQueryBuilder(
                        {
                            target: value,
                            type: 'value',
                            field: this.fieldMapper.getFieldName(field)
                        }
                    );
                // columns.add(`${propertyObj.field}.system`);
                // columns.add(`${propertyObj.field}.value`);
                //
                // break;

                case 'ContactPoint':
                    return exactMatchQueryBuilder(
                        {
                            target: value,
                            field: this.fieldMapper.getFieldName(`${field}.value`)
                        }
                    );
                // columns.add(`${propertyObj.field}.value`);
                // break;

                case 'boolean':
                    return exactMatchQueryBuilder(
                        {
                            target: value === 'true' ? true : false,
                            field: this.fieldMapper.getFieldName(field)
                        }
                    );
                // columns.add(`${propertyObj.field}`);
                // break;

                case 'code':
                case 'uri':
                case 'string':
                    return exactMatchQueryBuilder(
                        {
                            target: value,
                            field: this.fieldMapper.getFieldName(field)
                        }
                    );
                // columns.add(`${propertyObj.field}`);
                // break;

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
                // columns.add(`${propertyObj.field}.coding.system`);
                // columns.add(`${propertyObj.field}.coding.code`);
            }
        }
    }
}

module.exports = {
    FilterByToken
};
