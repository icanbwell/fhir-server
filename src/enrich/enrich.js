/**
 * Implements enrich function that finds any registered enrichment providers for that resource and runs them
 */

class EnrichmentManager {
    /**
     * constructor
     * @param {EnrichmentProvider[]} enrichmentProviders
     */
    constructor({enrichmentProviders}) {
        /**
         * @type {EnrichmentProvider[]}
         */
        this.enrichmentProviders = enrichmentProviders;
    }

    /**
     * Runs any registered enrichment providers
     * @param {Object} args
     * @param {Resource[]} resources
     * @param {Object} originalArgs
     * @return {Promise<Resource[]>}
     */
    async enrichAsync({resources, args, originalArgs}) {
        for (const enrichmentProvider of this.enrichmentProviders) {
            resources = await enrichmentProvider.enrichAsync(
                {
                    resources, args, originalArgs
                }
            );

        }
        return resources;
    }

    /**
     * Runs any registered enrichment providers
     * @param {Object} args
     * @param {BundleEntry[]} entries
     * @param {Object} originalArgs
     * @return {Promise<BundleEntry[]>}
     */
    async enrichBundleEntriesAsync({entries, args, originalArgs}) {
        for (const enrichmentProvider of this.enrichmentProviders) {
            entries = await enrichmentProvider.enrichBundleEntriesAsync(
                {
                    entries, args, originalArgs
                }
            );
        }
        return entries;
    }
}

module.exports = {
    EnrichmentManager
};
