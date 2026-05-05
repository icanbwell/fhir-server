/**
 * @typedef {Object} EnrichmentContext
 * @property {string|undefined} userType
 * @property {import('../../utils/fhirRequestInfo').JwtActor|undefined|null} actor
 */

/**
 * Abstract base class for an enrichment provider.  Inherit from this to create a new enrichment provider
 */
class EnrichmentProvider {
    /**
     * enrich the specified resources
     * @param {Resource[]} resources
     * @param {ParsedArgs} parsedArgs
     * @param {EnrichmentContext|undefined} enrichmentContext
     * @return {Promise<Resource[]>}
     */

    async enrichAsync ({ resources, parsedArgs, enrichmentContext }) {
        throw Error('Not Implemented');
    }

    /**
     * Runs any registered enrichment providers
     * @param {ParsedArgs} parsedArgs
     * @param {BundleEntry[]} entries
     * @param {EnrichmentContext|undefined} enrichmentContext
     * @return {Promise<BundleEntry[]>}
     */

    async enrichBundleEntriesAsync ({ entries, parsedArgs, enrichmentContext }) {
        throw Error('Not Implemented');
    }
}

module.exports = {
    EnrichmentProvider
};
