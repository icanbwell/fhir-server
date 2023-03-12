const {isUuid} = require('../../../utils/uid.util');
const {BaseFilter} = require('./baseFilter');
const {IdParser} = require('../../../utils/idParser');

const uuidFieldName = '_uuid';

/**
 * Filters by id
 * https://www.hl7.org/fhir/search.html#id
 * @param {ParsedArgsItem} parsedArg
 * @param {SearchParameterDefinition} propertyObj
 * @param {Set} columns
 * @param {FieldMapper} fieldMapper
 * @param {boolean|undefined} enableGlobalIdSupport
 * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>[]}
 */
class FilterById extends BaseFilter {
    /**
     * @param {string} field
     * @param {string} value
     * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>}
     */
    filterByItem(field, value) {
        if (this.enableGlobalIdSupport) {
            const {id, sourceAssigningAuthority} = IdParser.parse(value);
            if (isUuid(id)) {
                return {
                    [this.fieldMapper.getFieldName(uuidFieldName)]: id
                };
            } else if (sourceAssigningAuthority) {
                return {
                    $and: [
                        {
                            [this.fieldMapper.getFieldName(field)]: id,
                        },
                        {
                            [this.fieldMapper.getFieldName('_sourceAssigningAuthority')]: sourceAssigningAuthority
                        }
                    ]
                };
            } else {
                return {
                    [this.fieldMapper.getFieldName(field)]: id,
                };
            }
        } else {
            return {
                [this.fieldMapper.getFieldName(field)]: value
            };
        }
    }
}

module.exports = {
    FilterById
};
