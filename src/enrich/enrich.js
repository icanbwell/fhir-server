/**
 * Implements enrich function that finds any registered enrichment providers for that resource and runs them
 */
const {RethrownError} = require('../utils/rethrownError');

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
        try {
            for (const enrichmentProvider of this.enrichmentProviders) {
                resources = await enrichmentProvider.enrichAsync(
                    {
                        resources, args, originalArgs
                    }
                );

            }
            return resources;
        } catch (e) {
            throw new RethrownError({
                    message: 'Error in enrichAsync()',
                    error: e,
                    args: {resources, args, originalArgs}
                }
            );
        }
    }

    /**
     * Runs any registered enrichment providers
     * @param {Object} args
     * @param {BundleEntry[]} entries
     * @param {Object} originalArgs
     * @return {Promise<BundleEntry[]>}
     */
    async enrichBundleEntriesAsync({entries, args, originalArgs}) {
        try {
            for (const enrichmentProvider of this.enrichmentProviders) {
                entries = await enrichmentProvider.enrichBundleEntriesAsync(
                    {
                        entries, args, originalArgs
                    }
                );
            }
            return entries;
        } catch (e) {
            throw new RethrownError({
                    message: 'Error in enrichBundleEntriesAsync()',
                    error: e,
                    args: {entries, args, originalArgs}
                }
            );
        }
    }
}

module.exports = {
    EnrichmentManager
};
