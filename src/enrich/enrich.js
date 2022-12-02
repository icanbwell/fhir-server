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
     * @param {string} resourceType
     * @param {Object} originalArgs
     * @return {Promise<Resource[]>}
     */
    async enrichAsync({resources, resourceType, args, originalArgs}) {
        for (const enrichmentProvider of this.enrichmentProviders) {
            if (enrichmentProvider.canEnrich({resourceType})) {
                resources = await enrichmentProvider.enrichAsync({resources, resourceType, args, originalArgs});
            }
        }
        return resources;
    }
}

module.exports = {
    EnrichmentManager
};
