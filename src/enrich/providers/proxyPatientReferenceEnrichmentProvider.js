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
                if (value && typeof value === 'string' &&
                    (value.startsWith('Patient/person.') || value.startsWith('person.'))
                ) {
                    proxyPatientPersonId = value;
                    proxyPatientPersonIdKey = key;
                }
            }
        }
        if (proxyPatientPersonId && proxyPatientPersonIdKey) {
            /**
             * @type {string[]}
             */
            const proxyPatientIds = args[`${proxyPatientPersonIdKey}`].split(',').map(
                a => a.startsWith('Patient/') ? a : `Patient/${a}`);
            for (const resource of resources) {
                resource.updateReferences({
                    fnUpdateReference: (reference) => {
                        if (reference.reference && proxyPatientIds.includes(reference.reference)) {
                            reference.reference = proxyPatientPersonId.startsWith('Patient/') ?
                                proxyPatientPersonId : `Patient/${proxyPatientPersonId}`;
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
