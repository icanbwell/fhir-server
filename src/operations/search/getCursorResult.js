class GetCursorResult {
    /**
     *
     * @param {number | null} cursorBatchSize
     * @param {DatabaseCursor|null} cursor
     * @param {string | null} indexHint
     * @param {boolean} useTwoStepSearchOptimization
     * @param {Set} columns
     * @param {number | null} total_count
     * @param {import('mongodb').Document} query
     * @param {import('mongodb').FindOneOptions} options
     * @param {Resource[]} resources
     * @param {QueryItem|QueryItem[]} originalQuery
     * @param {import('mongodb').FindOneOptions|import('mongodb').FindOneOptions[]} originalOptions
     */
    constructor (
        {
            cursorBatchSize,
            cursor,
            indexHint,
            useTwoStepSearchOptimization,
            columns,
            total_count,
            query,
            options,
            resources,
            originalQuery,
            originalOptions
        }
    ) {
        /**
         * @type {number|null}
         */
        this.cursorBatchSize = cursorBatchSize;
        /**
         * @type {DatabaseCursor|null}
         */
        this.cursor = cursor;
        /**
         * @type {string|null}
         */
        this.indexHint = indexHint;
        /**
         * @type {boolean}
         */
        this.useTwoStepSearchOptimization = useTwoStepSearchOptimization;
        /**
         * @type {Set}
         */
        this.columns = columns;
        /**
         * @type {number|null}
         */
        this.total_count = total_count;
        /**
         * @type {Document}
         */
        this.query = query;
        /**
         * @type {*}
         */
        this.options = options;
        /**
         * @type {Resource[]}
         */
        this.resources = resources;
        /**
         * @type {QueryItem|QueryItem[]}
         */
        this.originalQuery = originalQuery;
        /**
         * @type {*|import('mongodb').FindOneOptions[]}
         */
        this.originalOptions = originalOptions;
    }
}

module.exports = {
    GetCursorResult
};
