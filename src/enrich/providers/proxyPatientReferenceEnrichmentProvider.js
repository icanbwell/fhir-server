const {EnrichmentProvider} = require('./enrichmentProvider');
const {getFirstResourceOrNull} = require('../../utils/list.util');

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
            // now copy the latest Patient and set the id to proxyPatient
            const patientResources = resources.filter(r => r.resourceType === 'Patient')
                .sort((a, b) => (a.meta.lastUpdated > b.meta.lastUpdated ? -1 : 1));
            const latestPatientResource = getFirstResourceOrNull(patientResources);
            if (latestPatientResource) {
                // remove all other Patient resources except the latest
                resources = resources.filter(r => r.resourceType !== 'Patient' || r.id === latestPatientResource.id);
                // and set the id of the latest Patient resource to proxyPatient
                latestPatientResource.id = proxyPatientPersonId;
            }
        }
        return resources;
    }
}

module.exports = {
    ProxyPatientReferenceEnrichmentProvider
};
