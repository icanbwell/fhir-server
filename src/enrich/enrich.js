/**
 * Implements enrich function that finds any registered enrichment providers for that resource and runs them
 */

const ExplanationOfBenefitsEnrichmentProvider = require('./providers/explanationOfBenefitsEnrichmentProvider');

/**
 * Registered set of enrichment providers
 * @type {EnrichmentProvider[]}
 */
const enrichmentProviders = [new ExplanationOfBenefitsEnrichmentProvider()];

class EnrichmentManager {
    /**
     * Runs any registered enrichment providers
     * @param {Resource[]} resources
     * @param {string} resourceType
     * @return {Promise<Resource[]>}
     */
    async enrich(resources, resourceType) {
        for (const enrichmentProvider of enrichmentProviders) {
            if (enrichmentProvider.canEnrich(resourceType)) {
                resources = await enrichmentProvider.enrich(resources, resourceType);
            }
        }
        return resources;
    }
}

module.exports = {
    EnrichmentManager
};
