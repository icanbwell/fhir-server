/**
 * Abstract base class for an enrichment provider.  Inherit from this to create a new enrichment provider
 */
class EnrichmentProvider {
    /**
     * enrich the specified resources
     * @param {Resource[]} resources
     * @param {Object} args
     * @param {Object} originalArgs
     * @return {Promise<Resource[]>}
     */
    // eslint-disable-next-line no-unused-vars
    async enrichAsync({resources, args, originalArgs}) {
        throw Error('Not Implemented');
    }

    /**
     * Runs any registered enrichment providers
     * @param {Object} args
     * @param {BundleEntry[]} entries
     * @param {Object} originalArgs
     * @return {Promise<BundleEntry[]>}
     */
    // eslint-disable-next-line no-unused-vars
    async enrichBundleEntriesAsync({entries, args, originalArgs}) {
        throw Error('Not Implemented');
    }
}

module.exports = {
    EnrichmentProvider
};
