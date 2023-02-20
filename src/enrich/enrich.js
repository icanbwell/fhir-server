/**
 * Implements enrich function that finds any registered enrichment providers for that resource and runs them
 */
const {RethrownError} = require('../utils/rethrownError');
const {assertTypeEquals} = require('../utils/assertType');
const {ParsedArgs} = require('../operations/query/parsedArgsItem');
const Resource = require('../fhir/classes/4_0_0/resources/resource');
const BundleEntry = require('../fhir/classes/4_0_0/backbone_elements/bundleEntry');

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
     * @param {ParsedArgs} parsedArgs
     * @param {Resource[]} resources
     * @return {Promise<Resource[]>}
     */
    async enrichAsync({resources, parsedArgs}) {
        assertTypeEquals(parsedArgs, ParsedArgs);
        try {
            for (const enrichmentProvider of this.enrichmentProviders) {
                resources = await enrichmentProvider.enrichAsync(
                    {
                        resources, parsedArgs
                    }
                );
                resources.forEach(resource => assertTypeEquals(resource, Resource));
            }
            return resources;
        } catch (e) {
            throw new RethrownError({
                    message: 'Error in enrichAsync()',
                    error: e,
                    args: {resources, parsedArgs}
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
    async enrichBundleEntriesAsync({entries, parsedArgs}) {
        try {
            for (const enrichmentProvider of this.enrichmentProviders) {
                entries = await enrichmentProvider.enrichBundleEntriesAsync(
                    {
                        entries, parsedArgs
                    }
                );
            }
            entries.forEach(entry => assertTypeEquals(entry, BundleEntry));
            return entries;
        } catch (e) {
            throw new RethrownError({
                    message: 'Error in enrichBundleEntriesAsync()',
                    error: e,
                    args: {entries, parsedArgs}
                }
            );
        }
    }
}

module.exports = {
    EnrichmentManager
};
