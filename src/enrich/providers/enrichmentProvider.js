/**
 * Abstract base class for an enrichment provider.  Inherit from this to create a new enrichment provider
 */
class EnrichmentProvider {
    /**
     * enrich the specified resources
     * @param {Resource[]} resources
     * @param {ParsedArgs} parsedArgs
     * @return {Promise<Resource[]>}
     */

    async enrichAsync ({ resources, parsedArgs }) {
        throw Error('Not Implemented');
    }

    /**
     * Runs any registered enrichment providers
     * @param {ParsedArgs} parsedArgs
     * @param {BundleEntry[]} entries
     * @return {Promise<BundleEntry[]>}
     */

    async enrichBundleEntriesAsync ({ entries, parsedArgs }) {
        throw Error('Not Implemented');
    }
}

module.exports = {
    EnrichmentProvider
};
