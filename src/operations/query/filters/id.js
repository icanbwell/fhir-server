const { FieldMapper } = require('./fieldMapper');
const {isUuid} = require('../../../utils/uid.util');
const {BaseFilter} = require('./baseFilter');
const {IdParser} = require('../../../utils/idParser');

const uuidFieldName = '_uuid';

/**
 * Filters by id
 * https://www.hl7.org/fhir/search.html#id
 */
class FilterById extends BaseFilter {
    /**
     * @param {string} field
     * @param {string} value
     * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>|import('mongodb').Filter<import('mongodb').DefaultSchema>[]}
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

    /**
     * Get filter for list of ids
     * @param {String[]} values
     * @returns {{_uuid: {$in}}|{_sourceId: {$in}}|{$or: ({_uuid: {$in}}|{_sourceId: {$in}})[]}}
     */
    static getListFilter(values){
        const idFieldMapper = new FieldMapper({useHistoryTable: false});
        let uuids = values.filter(value => idFieldMapper.getFieldName('id', value) === '_uuid');
        let sourceIds = values.filter(value => idFieldMapper.getFieldName('id', value) === '_sourceId');
        let query;
        const uuidQuery = {'_uuid': {$in: uuids}};
        const sourceIdQuery = {'_sourceId': {$in: sourceIds}};

        if (uuids.length && sourceIds.length){
            query = {$or: [uuidQuery, sourceIdQuery]};
        } else {
            query = uuids.length ? uuidQuery : sourceIdQuery;
        }
        return query;

    }
}

module.exports = {
    FilterById
};
