/**
 * Implements enrich function that finds any registered enrichment providers for that resource and runs them
 */
const { RethrownError } = require('../utils/rethrownError');
const { assertTypeEquals, assertIsValid } = require('../utils/assertType');
const { ParsedArgs } = require('../operations/query/parsedArgs');
const Resource = require('../fhir/classes/4_0_0/resources/resource');
const BundleEntry = require('../fhir/classes/4_0_0/backbone_elements/bundleEntry');

class EnrichmentManager {
    /**
     * constructor
     * @param {EnrichmentProvider[]} enrichmentProviders
     */
    constructor ({ enrichmentProviders }) {
        /**
         * @type {EnrichmentProvider[]}
         */
        this.enrichmentProviders = enrichmentProviders;
    }

    /**
     * Runs any registered enrichment providers
     * @param {ParsedArgs} parsedArgs
     * @param {Resource[]} resources
     * @return {Promise<Resource[]>}
     */
    async enrichAsync ({ resources, parsedArgs }) {
        assertTypeEquals(parsedArgs, ParsedArgs);
        try {
            for (const enrichmentProvider of this.enrichmentProviders) {
                resources = await enrichmentProvider.enrichAsync(
                    {
                        resources, parsedArgs
                    }
                );
            }
            return resources;
        } catch (e) {
            throw new RethrownError({
                    message: 'Error in enrichAsync()',
                    error: e,
                    args: { resources, parsedArgs }
                }
            );
        }
    }

    /**
     * Runs any registered enrichment providers
     * @param {ParsedArgs} parsedArgs
     * @param {BundleEntry[]} entries
     * @return {Promise<BundleEntry[]>}
     */
    async enrichBundleEntriesAsync ({ entries, parsedArgs }) {
        try {
            assertIsValid(entries !== null && entries !== undefined, 'entries is null');
            assertIsValid(Array.isArray(entries), 'entries is not an array');
            for (const /** @type {EnrichmentProvider} */ enrichmentProvider of this.enrichmentProviders) {
                entries = await enrichmentProvider.enrichBundleEntriesAsync(
                    {
                        entries, parsedArgs
                    }
                );
            }
            return entries;
        } catch (e) {
            throw new RethrownError({
                    message: 'Error in enrichBundleEntriesAsync()',
                    error: e,
                    args: { entries, parsedArgs }
                }
            );
        }
    }
}

module.exports = {
    EnrichmentManager
};
