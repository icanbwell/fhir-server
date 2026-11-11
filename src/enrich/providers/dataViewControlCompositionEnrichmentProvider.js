const { EnrichmentProvider } = require('./enrichmentProvider');
const { filterCompositionBlockedReferenceSections } = require('../../utils/compositionSectionFilter');

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
        const excludeMap = enrichmentContext?.viewControlExcludeMap;
        if (!excludeMap || Object.keys(excludeMap).length === 0) {
            return resources;
        }
        for (const resource of resources) {
            this.filterResource(resource, excludeMap);
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
     * @param {Readonly<{[resourceType: string]: ReadonlyArray<string>}>} excludeMap
     */
    filterResource(resource, excludeMap) {
        if (resource?.resourceType === 'Composition') {
            filterCompositionBlockedReferenceSections(resource, excludeMap);
        }
        for (const contained of resource?.contained || []) {
            this.filterResource(contained, excludeMap);
        }
    }
}

module.exports = {
    DataViewControlCompositionEnrichmentProvider
};
