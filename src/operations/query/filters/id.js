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

    /**
     * Generates filter for parsedArgItem
     * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>[]}
     */
    filter() {
        /**
         * @type {import('mongodb').Filter<import('mongodb').DefaultSchema>[]}
         */
        const and_segments = [];

        if (this.parsedArg.queryParameterValue.values) {
            and_segments.push({
                    $or: this.propertyObj.fields.flatMap((field) => {
                            return {
                                [this.parsedArg.queryParameterValue.operator]:
                                this.filterByItems(field, this.parsedArg.queryParameterValue.values)
                            };
                        }
                    ),
                },
            );
        }

        return and_segments;
    }

    /**
     * Generate filter based of field and values
     * @param {string} field
     * @param {string[]} values
     * @returns {Array<Object>}
     */
    filterByItems(field, values) {
        if (this.enableGlobalIdSupport) {
            const filters = [];
            /**
             * 3 types of values are possible
             * 1. uuid, 2. sourceId, 3. sourceId and sourceAssigningAuthority
             */
            let /**@type {string[]}*/uuids = [], /**@type {string[]}*/sourceIds = [], /**@type {string[]}*/sourceIdsWithSourceAssigningAuthority = [];

            values.forEach((value) => {
                const {id, sourceAssigningAuthority} = IdParser.parse(value);
                if (isUuid(id)) {
                    uuids.push(id);
                } else if (sourceAssigningAuthority) {
                    sourceIdsWithSourceAssigningAuthority.push(value);
                } else {
                    sourceIds.push(id);
                }
            });

            if (uuids.length > 0) {
                filters.push({
                    [this.fieldMapper.getFieldName(uuidFieldName)]: {
                        $in: uuids,
                    }
                });
            }

            if (sourceIds.length > 0) {
                filters.push({
                    [this.fieldMapper.getFieldName(field)]: {
                        $in: sourceIds,
                    }
                });
            }

            if (sourceIdsWithSourceAssigningAuthority.length > 0) {
                filters.push(...sourceIdsWithSourceAssigningAuthority.flatMap(v => this.filterByItem(field, v)));
            }
            return filters;
        } else {
            return values.flatMap((v) => this.filterByItem(field, v));
        }
    }

}

module.exports = {
    FilterById
};
