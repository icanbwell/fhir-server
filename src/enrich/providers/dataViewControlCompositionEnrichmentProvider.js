const { EnrichmentProvider } = require('./enrichmentProvider');
const {
    buildBlockedIdSetByType,
    filterCompositionBlockedReferenceSections
} = require('../../utils/compositionSectionFilter');

/**
 * Removes Composition sections that reference a resource the subject's dataConnectionViewControl
 * Consent hides, so a summary can't show what the search itself filtered out.
 *
 * It filters by the exclude map in the enrichment context, and does nothing without one. Read paths
 * that apply view control put it there (from ParsedArgs.viewControlExcludeMap, or $everything's own
 * lookup); paths that don't (service tokens that didn't opt in, $graph, $summary) leave it out.
 * The map is passed in rather than looked up here, because PatientDataViewControlExclusion depends
 * on the search stack that runs this provider.
 */
class DataViewControlCompositionEnrichmentProvider extends EnrichmentProvider {
    /**
     * @param {Object} params
     * @param {Resource[]} params.resources
     * @param {ParsedArgs} params.parsedArgs
     * @param {EnrichmentContext|undefined} params.enrichmentContext
     * @returns {Promise<Resource[]>}
     */
    async enrichAsync({ resources, enrichmentContext }) {
        // built once per call, not once per Composition: the exclude map can list thousands of ids
        const blockedIdSetByType = buildBlockedIdSetByType(enrichmentContext?.viewControlExcludeMap);
        if (Object.keys(blockedIdSetByType).length === 0) {
            return resources;
        }
        for (const resource of resources) {
            this.filterResource(resource, blockedIdSetByType);
        }
        return resources;
    }

    /**
     * @param {Object} params
     * @param {BundleEntry[]} params.entries
     * @param {ParsedArgs} params.parsedArgs
     * @param {EnrichmentContext|undefined} params.enrichmentContext
     * @returns {Promise<BundleEntry[]>}
     */
    async enrichBundleEntriesAsync({ entries, parsedArgs, enrichmentContext }) {
        await this.enrichAsync({
            resources: entries.map((entry) => entry.resource).filter(Boolean),
            parsedArgs,
            enrichmentContext
        });
        return entries;
    }

    /**
     * Filters a Composition and any Composition among its contained resources, in place.
     * @param {Object} resource
     * @param {{[resourceType: string]: Set<string>}} blockedIdSetByType
     */
    filterResource(resource, blockedIdSetByType) {
        if (resource?.resourceType === 'Composition') {
            filterCompositionBlockedReferenceSections(resource, blockedIdSetByType);
        }
        for (const contained of resource?.contained || []) {
            this.filterResource(contained, blockedIdSetByType);
        }
    }
}

module.exports = {
    DataViewControlCompositionEnrichmentProvider
};
