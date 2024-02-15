const {EnrichmentProvider} = require('./enrichmentProvider');

class IdEnrichmentProvider extends EnrichmentProvider {
    /**
     * enrich the specified resources
     * @param {Resource[]} resources
     * @param {ParsedArgs} parsedArgs
     * @return {Promise<Resource[]>}
     */
    // eslint-disable-next-line no-unused-vars
    async enrichAsync ({resources, parsedArgs}) {
        for (const resource of resources) {
            if (resource._sourceId) {
                resource.id = resource._sourceId;
            }
        }
        return resources;
    }

    /**
     * Runs any registered enrichment providers
     * @param {ParsedArgs} parsedArgs
     * @param {BundleEntry[]} entries
     * @return {Promise<BundleEntry[]>}
     */
    // eslint-disable-next-line no-unused-vars
    async enrichBundleEntriesAsync ({entries, parsedArgs}) {
        return entries;
    }
}

module.exports = {
    IdEnrichmentProvider
};
