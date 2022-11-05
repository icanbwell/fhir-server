/**
 * Implements enrich function that finds any registered enrichment providers for that resource and runs them
 */

const ExplanationOfBenefitsEnrichmentProvider = require('./providers/explanationOfBenefitsEnrichmentProvider');

/**
 * Registered set of enrichment providers
 * @type {EnrichmentProvider[]}
 */
const defaultEnrichmentProviders = [new ExplanationOfBenefitsEnrichmentProvider()];

class EnrichmentManager {
    /**
     * constructor
     * @param {EnrichmentProvider[]|undefined|null} [enrichmentProviders]
     */
    constructor({enrichmentProviders}) {
        this.enrichmentProviders = enrichmentProviders || defaultEnrichmentProviders;
    }

    /**
     * Runs any registered enrichment providers
     * @param {Resource[]} resources
     * @param {string} resourceType
     * @return {Promise<Resource[]>}
     */
    async enrichAsync(resources, resourceType) {
        for (const enrichmentProvider of this.enrichmentProviders) {
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
