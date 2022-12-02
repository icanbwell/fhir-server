const {EnrichmentProvider} = require('./enrichmentProvider');

class ProxyPatientReferenceEnrichmentProvider extends EnrichmentProvider {
    /**
     * enrich the specified resources
     * @param {Resource[]} resources
     * @param {Object} args
     * @param originalArgs
     * @return {Promise<Resource[]>}
     */
    // eslint-disable-next-line no-unused-vars
    async enrichAsync({resources, args, originalArgs}) {
        // check if any args have a proxy patient
        /**
         * @type {string|null}
         */
        let proxyPatientPersonId = null;
        let proxyPatientPersonIdKey = null;
        if (originalArgs) {
            for (const [key, value] of Object.entries(originalArgs)) {
                if (value && value.startsWith('Patient/person.')) {
                    proxyPatientPersonId = value;
                    proxyPatientPersonIdKey = key;
                }
            }
        }
        if (proxyPatientPersonId && proxyPatientPersonIdKey) {
            /**
             * @type {string[]}
             */
            const proxyPatientIds = args[`${proxyPatientPersonIdKey}`].split(',');
            for (const resource of resources) {
                resource.updateReferences({
                    fnUpdateReference: (reference) => {
                        if (reference.reference && proxyPatientIds.includes(reference.reference)) {
                            reference.reference = proxyPatientPersonId;
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
