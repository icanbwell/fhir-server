const { EnrichmentProvider } = require('./enrichmentProvider');
const { filterCompositionSensitiveSections } = require('../../utils/compositionSectionFilter');

/**
 * Enrichment provider that strips sensitive sections from Composition resources
 * for delegated users based on consent rules.
 *
 * Reads userType from enrichmentContext to determine if filtering applies.
 * Delegates to filterCompositionSensitiveSections utility for the actual filtering logic.
 */
class CompositionSectionFilterEnrichmentProvider extends EnrichmentProvider {
    /**
     * @param {Object} params
     * @param {import('../../utils/configManager').ConfigManager} params.configManager
     */
    constructor({ configManager }) {
        super();
        /**
         * @type {import('../../utils/configManager').ConfigManager}
         */
        this.configManager = configManager;
    }

    /**
     * Filter sensitive sections from Composition resources
     * @param {Object} params
     * @param {Resource[]} params.resources
     * @param {ParsedArgs} params.parsedArgs
     * @param {EnrichmentContext|undefined} params.enrichmentContext
     * @returns {Promise<Resource[]>}
     */
    async enrichAsync({ resources, parsedArgs, enrichmentContext }) {
        const userType = enrichmentContext?.userType;
        for (const resource of resources) {
            if (resource?.resourceType === 'Composition') {
                filterCompositionSensitiveSections(resource, {
                    configManager: this.configManager,
                    userType
                });
            }
            if (resource?.contained?.length) {
                resource.contained = await this.enrichAsync({
                    resources: resource.contained,
                    parsedArgs,
                    enrichmentContext
                });
            }
        }
        return resources;
    }

    /**
     * Filter sensitive sections from Composition resources in bundle entries
     * @param {Object} params
     * @param {BundleEntry[]} params.entries
     * @param {ParsedArgs} params.parsedArgs
     * @param {EnrichmentContext|undefined} params.enrichmentContext
     * @returns {Promise<BundleEntry[]>}
     */
    async enrichBundleEntriesAsync({ entries, parsedArgs, enrichmentContext }) {
       for (const entry of entries) {
            if (entry.resource) {
                entry.resource = (await this.enrichAsync(
                    {
                        resources: [entry.resource],
                        parsedArgs,
                        enrichmentContext
                    }
                ))[0];
            }
            entry.id = entry.resource.id;
        }
        return entries;
    }
}

module.exports = {
    CompositionSectionFilterEnrichmentProvider
};
