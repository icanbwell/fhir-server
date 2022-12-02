const {EnrichmentProvider} = require('./enrichmentProvider');

class IdEnrichmentProvider extends EnrichmentProvider {
    /**
     * enrich the specified resources
     * @param {Resource[]} resources
     * @param {Object} args
     * @param {Object} originalArgs
     * @return {Promise<Resource[]>}
     */
    // eslint-disable-next-line no-unused-vars
    async enrichAsync({resources, args, originalArgs}) {
        for (const resource of resources) {
            if (resource._sourceId) {
                resource.id = resource._sourceId;
            }
        }
        return resources;
    }
}

module.exports = {
    IdEnrichmentProvider
};
