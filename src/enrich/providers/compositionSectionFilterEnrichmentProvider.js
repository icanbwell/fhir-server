const { EnrichmentProvider } = require('./enrichmentProvider');
const { filterCompositionSensitiveSections } = require('../../utils/compositionSectionFilter');
const { AUTH_USER_TYPES } = require('../../constants');

/**
 * Enrichment provider that strips sensitive sections from Composition resources
 * for delegated users based on consent rules.
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
     * Reads the denied sensitive categories Set from the actor's pre-loaded filtering rules.
     * @param {EnrichmentContext|undefined} enrichmentContext
     * @returns {Set<string>|null}
     */
    getDeniedSensitiveCategorySet(enrichmentContext) {
        const filteringRules = enrichmentContext?.actor?._filteringRules;
        if (!filteringRules) {
            return null;
        }
        return new Set(filteringRules.deniedSensitiveCategories || []);
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
        if (
            !this.configManager.enableDelegatedAccessDetection ||
            enrichmentContext?.userType !== AUTH_USER_TYPES.delegatedUser
        ) {
            return resources;
        }

        const deniedSensitiveCategorySet = this.getDeniedSensitiveCategorySet(enrichmentContext);
        if (!deniedSensitiveCategorySet) {
            return resources;
        }
        for (const resource of resources) {
            if (resource?.resourceType === 'Composition') {
                filterCompositionSensitiveSections(resource, deniedSensitiveCategorySet);
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
        }
        return entries;
    }
}

module.exports = {
    CompositionSectionFilterEnrichmentProvider
};
