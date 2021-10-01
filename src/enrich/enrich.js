class EnrichmentProvider {
    /**
     * Whether this Enrichment can enrich the specified resourceType
     * @param {string} resourceType
     * @return {boolean}
     */
    // eslint-disable-next-line no-unused-vars
    canEnrich(resourceType) {
        throw Error('Not Implemented');
    }

    /**
     * enrich the specified resources
     * @param {Resource[]} resources
     * @param {string} resourceType
     * @return {Promise<Resource[]>}
     */
    // eslint-disable-next-line no-unused-vars
    async enrich(resources, resourceType) {
        throw Error('Not Implemented');
    }
}

class ExplanationOfBenefitsEnrichmentProvider extends EnrichmentProvider {
    /**
     * Whether this Enrichment can enrich the specified resourceType
     * @param {string} resourceType
     * @return {boolean}
     */
    canEnrich(resourceType) {
        return (resourceType === 'ExplanationOfBenefit');
    }

    /**
     * enrich the specified resources
     * @param {Resource[]} resources
     * @param {string} resourceType
     * @return {Promise<Resource[]>}
     */
    // eslint-disable-next-line no-unused-vars
    async enrich(resources, resourceType) {
        return resources;
    }
}


/**
 * Registered set of enrichment providers
 * @type {EnrichmentProvider[]}
 */
const enrichmentProviders = [
    new ExplanationOfBenefitsEnrichmentProvider()
];

/**
 * Runs any registered enrichment providers
 * @param {Resource[]} resources
 * @param {string} resourceType
 * @return {Promise<Resource[]>}
 */
module.exports.enrich = async (resources, resourceType) => {
    for (const enrichmentProvider of enrichmentProviders) {
        if (enrichmentProvider.canEnrich(resourceType)) {
            resources = await enrichmentProvider.enrich(resources, resourceType);
        }
    }
    return resources;
};
