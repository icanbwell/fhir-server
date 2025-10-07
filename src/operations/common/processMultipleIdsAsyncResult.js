class ProcessMultipleIdsAsyncResult {
    /**
     * constructor
     * @param {BundleEntry[]} entries
     * @param {QueryItem[]} queryItems
     * @param {import('mongodb').FindOptions<import('mongodb').DefaultSchema>[]} options
     * @param {import('mongodb').Document[]} explanations
     * @param {ResourceIdentifier[]} bundleEntryIdsProcessed
     * @param {{id: string, resourceType: string}[]} streamedResources
     */
    constructor ({
                    entries,
                    queryItems,
                    options,
                    explanations,
                    bundleEntryIdsProcessed,
                    streamedResources
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

        /**
         * @type {{id: string, resourceType: string}[]}
         */
        this.streamedResources = streamedResources || [];
    }
}

module.exports = {
    ProcessMultipleIdsAsyncResult
};
