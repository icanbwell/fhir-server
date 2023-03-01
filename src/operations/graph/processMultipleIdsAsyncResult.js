class ProcessMultipleIdsAsyncResult {
    /**
     * constructor
     * @param {BundleEntry[]} entries
     * @param {QueryItem[]} queryItems
     * @param {import('mongodb').FindOptions<import('mongodb').DefaultSchema>[]} options
     * @param {import('mongodb').Document[]} explanations
     */
    constructor({
                    entries,
                    queryItems,
                    options,
                    explanations
                }) {
        /**
         * @type {BundleEntry[]}
         */
        this.entries = entries;
        /**
         * @type {QueryItem[]}
         */
        this.queryItems = queryItems;
        /**
         * @type {import('mongodb').FindOptions<import('mongodb').DefaultSchema>[]}
         */
        this.options = options;
        /**
         * @type {import('mongodb').Document[]}
         */
        this.explanations = explanations;
    }
}

module.exports = {
    ProcessMultipleIdsAsyncResult
};
