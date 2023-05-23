const idToFieldNameMap = {
    'id': '_sourceId',
    '_uuid': '_uuid'
};

class FieldMapper {
    /**
     *
     * @param {boolean|undefined} enableGlobalIdSupport
     * @param {boolean|undefined} useHistoryTable
     */
    constructor(
        {
            enableGlobalIdSupport,
            useHistoryTable,
            defaultSortId,
        }
    ) {
        /**
         * @type {boolean|undefined}
         */
        this.enableGlobalIdSupport = enableGlobalIdSupport;
        /**
         * @type {boolean|undefined}
         */
        this.useHistoryTable = useHistoryTable;
        /**
         * @type {string}
         */
        this.defaultSortId = defaultSortId;
    }

    /**
     * Gets field name (replacing if it is 'id' and enableGlobalIdSupport is enabled.
     * In case of useHistoryTable, prepends the field namewith 'resource.' since in history we store data as a BundleEntry
     * @param {string} field
     * @return {string}
     */
    getFieldName(field) {
        const fieldName = field === 'id' ? idToFieldNameMap[this.defaultSortId] : field;
        return this.useHistoryTable ? `resource.${fieldName}` : fieldName;
    }
}

module.exports = {
    FieldMapper
};
