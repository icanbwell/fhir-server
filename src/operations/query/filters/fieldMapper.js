const { isUuid } = require('../../../utils/uid.util');

const uuidFieldName = '_uuid';
const sourceIdFieldName = '_sourceId';

class FieldMapper {
    /**
     *
     * @param {boolean|undefined} useHistoryTable
     */
    constructor(
        {
            useHistoryTable
        }
    ) {
        /**
         * @type {boolean|undefined}
         */
        this.useHistoryTable = useHistoryTable;
    }

    /**
     * Gets field name (replacing if it is 'id')
     * In case of useHistoryTable, prepends the field namewith 'resource.' since in history we store data as a BundleEntry
     * @param {string} field
     * @param {string} [value]
     * @return {string}
     */
    getFieldName(field, value) {
        const fieldName = field === 'id' ?
            isUuid(value) ? uuidFieldName : sourceIdFieldName :
            field;
        return this.useHistoryTable ? `resource.${fieldName}` : fieldName;
    }
}

module.exports = {
    FieldMapper
};
