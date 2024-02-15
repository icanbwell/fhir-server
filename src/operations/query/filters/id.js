const { isUuid } = require('../../../utils/uid.util');
const { BaseFilter } = require('./baseFilter');
const { IdParser } = require('../../../utils/idParser');
const { FieldMapper } = require('./fieldMapper');

const uuidFieldName = '_uuid';

/**
 * Filters by id
 * https://www.hl7.org/fhir/search.html#id
 */
class FilterById extends BaseFilter {
    /**
     * Get filter for list of ids
     * @param {String[]} values
     * @returns {{_uuid: {$in}}|{_sourceId: {$in}}|{$or: ({_uuid: {$in}}|{_sourceId: {$in}})[]}}
     */
    static getListFilter (values) {
        if (!values || values.length === 0) {
            return { '_uuid': { $in: [] } };
        }

        const idFieldMapper = new FieldMapper({ useHistoryTable: false });
        const filter = FilterById.filterByItems('id', values, idFieldMapper);
        let query;

        if (filter.length > 1) {
            query = { $or: filter };
        } else {
            query = filter[0];
        }
        return query;
    }

    /**
     * Generates filter for parsedArgItem
     * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>[]}
     */
    filter () {
        /**
         * @type {import('mongodb').Filter<import('mongodb').DefaultSchema>[]}
         */
        const and_segments = [];

        if (this.parsedArg.queryParameterValue.values) {
            and_segments.push({
                    $or: this.propertyObj.fields.flatMap((field) => {
                            return {
                                [this.parsedArg.queryParameterValue.operator]:
                                FilterById.filterByItems(field, this.parsedArg.queryParameterValue.values, this.fieldMapper)
                            };
                        }
                    )
                }
            );
        }

        return and_segments;
    }

    /**
     * Generate filter based of field and values
     * @param {string} field
     * @param {string[]} values
     * @param {import('./fieldMapper').FieldMapper} fieldMapper
     * @returns {Array<Object>}
     */
    static filterByItems (field, values, fieldMapper) {
        const filters = [];
        /**
         * 2 types of values are possible
         * 1. uuid, 2. sourceId
         */
        const /** @type {string[]} */uuids = [];
        /** @type {string[]} */
        const sourceIds = [];

        values.forEach((value) => {
            const { id } = IdParser.parse(value);
            if (isUuid(id)) {
                uuids.push(id);
            } else {
                sourceIds.push(id);
            }
        });

        if (uuids.length > 0) {
            filters.push({
                [fieldMapper.getFieldName(uuidFieldName)]: {
                    $in: uuids
                }
            });
        }

        if (sourceIds.length > 0) {
            filters.push({
                [fieldMapper.getFieldName(field)]: {
                    $in: sourceIds
                }
            });
        }
        return filters;
    }
}

module.exports = {
    FilterById
};
