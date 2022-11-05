/**
 * Implements enrich function that finds any registered enrichment providers for that resource and runs them
 */

const {ExplanationOfBenefitsEnrichmentProvider} = require('./providers/explanationOfBenefitsEnrichmentProvider');
const {IdEnrichmentProvider} = require('./providers/idEnrichmentProvider');

/**
 * Registered set of enrichment providers
 * @type {EnrichmentProvider[]}
 */
const defaultEnrichmentProviders = [new ExplanationOfBenefitsEnrichmentProvider(), new IdEnrichmentProvider()];

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
     * @param {Object} args
     * @param {Resource[]} resources
     * @param {string} resourceType
     * @return {Promise<Resource[]>}
     */
    async enrichAsync({resources, resourceType, args}) {
        for (const enrichmentProvider of this.enrichmentProviders) {
            if (enrichmentProvider.canEnrich({resourceType})) {
                resources = await enrichmentProvider.enrich({resources, resourceType, args});
            }
        }
        return resources;
    }
}

module.exports = {
    EnrichmentManager
};
