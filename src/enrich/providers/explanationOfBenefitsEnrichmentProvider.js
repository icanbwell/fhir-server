const {EnrichmentProvider} = require('./enrichmentProvider');

class ExplanationOfBenefitsEnrichmentProvider extends EnrichmentProvider {
    /**
     * enrich the specified resources
     * @param {Resource[]} resources
     * @param {Object} args
     * @param {Object} originalArgs
     * @return {Promise<Resource[]>}
     */
    // eslint-disable-next-line no-unused-vars
    async enrichAsync({resources, args, originalArgs}) {
        return resources;
    }
}

module.exports = {
    ExplanationOfBenefitsEnrichmentProvider
};
