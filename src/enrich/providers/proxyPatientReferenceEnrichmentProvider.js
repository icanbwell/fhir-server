const {EnrichmentProvider} = require('./enrichmentProvider');

class ProxyPatientReferenceEnrichmentProvider extends EnrichmentProvider {
    /**
     * Whether this Enrichment can enrich the specified resourceType
     * @param {string} resourceType
     * @return {boolean}
     */
    // eslint-disable-next-line no-unused-vars
    canEnrich({resourceType}) {
        return true;
    }

    /**
     * enrich the specified resources
     * @param {Resource[]} resources
     * @param {string} resourceType
     * @param {Object} args
     * @return {Promise<Resource[]>}
     */
    // eslint-disable-next-line no-unused-vars
    async enrichAsync({resources, resourceType, args}) {
        // check if any args have a proxy patient
        /**
         * @type {string|null}
         */
        let proxyPatientId = null;
        if (args) {
            for (const [, value] of Object.entries(args)) {
                if (value && value.startsWith('Patient/person.')) {
                    proxyPatientId = value;
                }
            }
        }
        if (proxyPatientId !== null) {
            for (const resource of resources) {
                resource.updateReferences({
                    fnUpdateReference: (reference) => {
                        if (reference.reference && reference.reference.startsWith('Patient/')) {
                            reference.reference = proxyPatientId;
                        }
                        return reference;
                    }
                });
            }
        }
        return resources;
    }
}

module.exports = {
    ProxyPatientReferenceEnrichmentProvider
};
