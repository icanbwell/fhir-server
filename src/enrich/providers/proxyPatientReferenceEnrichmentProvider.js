const {EnrichmentProvider} = require('./enrichmentProvider');
const {getFirstResourceOrNull, getFirstBundleEntryOrNull} = require('../../utils/list.util');
const {assertTypeEquals} = require('../../utils/assertType');
const {ParsedArgs} = require('../../operations/query/parsedArgsItem');

class ProxyPatientReferenceEnrichmentProvider extends EnrichmentProvider {
    /**
     * enrich the specified resources
     * @param {Resource[]} resources
     * @param {ParsedArgs} parsedArgs
     * @return {Promise<Resource[]>}
     */
    async enrichAsync({resources, parsedArgs}) {
        assertTypeEquals(parsedArgs, ParsedArgs);
        // check if any args have a proxy patient
        let {proxyPatientPersonId, proxyPatientPersonIdKey} = this.getProxyPatientFromArgs({parsedArgs});
        if (proxyPatientPersonId && proxyPatientPersonIdKey) {
            /**
             * @type {ParsedArgsItem}
             */
            const parsedArgsItem = parsedArgs.get(`${proxyPatientPersonIdKey}`);
            if (parsedArgsItem) {
                /**
                 * @type {string[]}
                 */
                const proxyPatientIds = parsedArgsItem.queryParameterValues.map(
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
        }
        return resources;
    }

    /**
     * parses original proxy patient from original args
     * @param {ParsedArgs} parsedArgs
     * @return {{proxyPatientPersonId: (string|null), proxyPatientPersonIdKey: null}}
     */
    getProxyPatientFromArgs({parsedArgs}) {
        /**
         * @type {string|null}
         */
        let proxyPatientPersonId = null;
        let proxyPatientPersonIdKey = null;
        if (parsedArgs) {
            for (const parsedArgsItem of parsedArgs.originalParsedArgItems) {
                /**
                 * @type {string}
                 */
                const key = parsedArgsItem.queryParameter;
                /**
                 * @type {string[]}
                 */
                const values = parsedArgsItem.queryParameterValues;
                for (const value of values) {
                    if (value && typeof value === 'string' &&
                        (value.startsWith('Patient/person.') || value.startsWith('person.'))
                    ) {
                        proxyPatientPersonId = value;
                        proxyPatientPersonIdKey = key;
                    }
                }
            }
        }
        return {proxyPatientPersonId, proxyPatientPersonIdKey};
    }

    /**
     * Runs any registered enrichment providers
     * @param {ParsedArgs} parsedArgs
     * @param {BundleEntry[]} entries
     * @return {Promise<BundleEntry[]>}
     */
    async enrichBundleEntriesAsync({entries, parsedArgs}) {
        // check if any args have a proxy patient
        let {proxyPatientPersonId, proxyPatientPersonIdKey} = this.getProxyPatientFromArgs({parsedArgs});
        if (proxyPatientPersonId && proxyPatientPersonIdKey) {
            /**
             * @type {ParsedArgsItem}
             */
            const parsedArgsItem = parsedArgs.get(`${proxyPatientPersonIdKey}`);
            if (parsedArgsItem) {
                /**
                 * @type {string[]}
                 */
                const proxyPatientIds = parsedArgsItem.queryParameterValues.map(
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
        }
        return entries;
    }
}

module.exports = {
    ProxyPatientReferenceEnrichmentProvider
};
