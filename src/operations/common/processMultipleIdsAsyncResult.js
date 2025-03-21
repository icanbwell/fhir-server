class ProcessMultipleIdsAsyncResult {
    /**
     * constructor
     * @param {BundleEntry[]} entries
     * @param {QueryItem[]} queryItems
     * @param {import('mongodb').FindOptions<import('mongodb').DefaultSchema>[]} options
     * @param {import('mongodb').Document[]} explanations
     * @param {ResourceIdentifier[]} bundleEntryIdsProcessed
     */
    constructor ({
                    entries,
                    queryItems,
                    options,
                    explanations,
                    bundleEntryIdsProcessed
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

        /**
         * @type {ResourceIdentifier[]}
         */
        this.bundleEntryIdsProcessed = bundleEntryIdsProcessed;
    }
}

module.exports = {
    ProcessMultipleIdsAsyncResult
};
