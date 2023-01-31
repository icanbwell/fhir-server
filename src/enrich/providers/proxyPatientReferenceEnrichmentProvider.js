const {EnrichmentProvider} = require('./enrichmentProvider');
const {getFirstResourceOrNull, getFirstBundleEntryOrNull} = require('../../utils/list.util');

class ProxyPatientReferenceEnrichmentProvider extends EnrichmentProvider {
    /**
     * enrich the specified resources
     * @param {Resource[]} resources
     * @param {ParsedArgs} parsedArgs
     * @param originalArgs
     * @return {Promise<Resource[]>}
     */
    // eslint-disable-next-line no-unused-vars
    async enrichAsync({resources, parsedArgs, originalArgs}) {
        // check if any args have a proxy patient
        let {proxyPatientPersonId, proxyPatientPersonIdKey} = this.getProxyPatientFromArgs({originalArgs});
        if (proxyPatientPersonId && proxyPatientPersonIdKey) {
            /**
             * @type {string[]}
             */
            const proxyPatientIds = parsedArgs.get(`${proxyPatientPersonIdKey}`).queryParameterValue.map(
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

    getProxyPatientFromArgs({originalArgs}) {
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
        return {proxyPatientPersonId, proxyPatientPersonIdKey};
    }

    /**
     * Runs any registered enrichment providers
     * @param {ParsedArgs} parsedArgs
     * @param {BundleEntry[]} entries
     * @param {Object} originalArgs
     * @return {Promise<BundleEntry[]>}
     */
    // eslint-disable-next-line no-unused-vars
    async enrichBundleEntriesAsync({entries, parsedArgs, originalArgs}) {
        // check if any args have a proxy patient
        let {proxyPatientPersonId, proxyPatientPersonIdKey} = this.getProxyPatientFromArgs({originalArgs});
        if (proxyPatientPersonId && proxyPatientPersonIdKey) {
            /**
             * @type {string[]}
             */
            const proxyPatientIds = parsedArgs.get(`${proxyPatientPersonIdKey}`).queryParameterValue.map(
                a => a.startsWith('Patient/') ? a : `Patient/${a}`);
            for (const entry of entries) {
                entry.resource.updateReferences({
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
            const patientEntries = entries.filter(r => r.resource.resourceType === 'Patient')
                .sort(
                    (a, b) =>
                        (a.resource.meta.lastUpdated > b.resource.meta.lastUpdated ? -1 : 1)
                );
            const latestPatientEntry = getFirstBundleEntryOrNull(patientEntries);
            if (latestPatientEntry) {
                // remove all other Patient resources except the latest
                entries = entries.filter(
                    r => r.resource.resourceType !== 'Patient' ||
                        r.resource.id === latestPatientEntry.resource.id
                );
                // and set the id of the latest Patient resource to proxyPatient
                latestPatientEntry.resource.id = proxyPatientPersonId;
            }
        }
        return entries;
    }
}

module.exports = {
    ProxyPatientReferenceEnrichmentProvider
};
