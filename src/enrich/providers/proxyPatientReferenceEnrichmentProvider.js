const { EnrichmentProvider } = require('./enrichmentProvider');
const { assertTypeEquals } = require('../../utils/assertType');
const { ParsedArgs } = require('../../operations/query/parsedArgs');
const { PERSON_PROXY_PREFIX, PATIENT_REFERENCE_PREFIX } = require('../../constants');
const { isTrueWithFallback } = require('../../utils/isTrue');
const { ConfigManager } = require('../../utils/configManager');

class ProxyPatientReferenceEnrichmentProvider extends EnrichmentProvider {
    /**
     * @typedef ProxyPatientReferenceEnrichmentProviderParams
     * @property {ConfigManager} configManager
     *
     * constructor
     * @param {ProxyPatientReferenceEnrichmentProviderParams} params
     */
    constructor ({ configManager }) {
        super();
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    /**
     * enrich the specified resources
     * @param {Resource[]} resources
     * @param {ParsedArgs} parsedArgs
     * @return {Promise<Resource[]>}
     */
    async enrichAsync ({ resources, parsedArgs }) {
        assertTypeEquals(parsedArgs, ParsedArgs);
        const rewritePatientReference = isTrueWithFallback(parsedArgs['_rewritePatientReference'], this.configManager.rewritePatientReference);
        // if rewrite is false, then don't enrich the resources
        if (!rewritePatientReference) {
            return resources;
        }

        // check if any args have a proxy patient
        const { proxyPatientPersonId, proxyPatientPersonIdKey } = this.getProxyPatientFromArgs({ parsedArgs });
        if (proxyPatientPersonId && proxyPatientPersonIdKey) {
            /**
             * @type {import('../../operations/query/parsedArgsItem').ParsedArgsItem}
             */
            const parsedArgsItem = parsedArgs.get(`${proxyPatientPersonIdKey}`);
            if (parsedArgsItem) {
                const patientToPersonMap = parsedArgsItem.patientToPersonMap;

                /**
                 * @type {string[]}
                 */
                const patientIdsFromQueryParam =
                    parsedArgsItem?.queryParameterValue?.values?.map((a) =>
                        a.startsWith('Patient/') ? a : `Patient/${a}`
                    ) ?? [];
                for (const resource of resources) {
                    await resource.updateReferencesAsync({
                        fnUpdateReferenceAsync: async (reference) => {
                            /**
                             * if reference is present in patientIdsWithProxyPatient,
                             * then its patientReference and we need to replace it with correct proxy-patient
                             */
                            const patientReference = patientIdsFromQueryParam.find((v) => v === reference.reference || v === reference._uuid);
                            if (patientReference && (patientToPersonMap[`${patientReference}`] || patientToPersonMap[`${patientReference.replace(PATIENT_REFERENCE_PREFIX, '')}`])) {
                                // find person associated with it
                                const person = patientToPersonMap[`${patientReference}`] || patientToPersonMap[`${patientReference.replace(PATIENT_REFERENCE_PREFIX, '')}`];
                                reference.reference = `${PATIENT_REFERENCE_PREFIX}${PERSON_PROXY_PREFIX}${person}`;
                            }
                            return reference;
                        }
                    });
                }
                // now copy the latest Patient and set the id to proxyPatient
                const patientResources = resources.filter(r => r.resourceType === 'Patient');

                if (patientToPersonMap && patientResources.length > 0) {
                    patientResources.forEach((p) => {
                        const personId = this.findPersonIdFromMap(patientToPersonMap, p);
                        if (personId) {
                            p.id = `${PERSON_PROXY_PREFIX}${personId}`;
                        }
                    });
                }
            }
        }
        return resources;
    }

    /**
     * Find person id from given patientToPersonMap and patient-resource/reference
     * It search for both id and _uuid
     * @param {{[k: string]: string} | undefined} patientToPersonMap
     * @param {{ id: string, _uuid: string }} resource Reference or resource containing these felids
     * @returns {string|undefined}
     */
    findPersonIdFromMap (patientToPersonMap, resource) {
        if (patientToPersonMap) {
            if (patientToPersonMap[`${resource.id}`]) { return patientToPersonMap[`${resource.id}`]; }
            if (patientToPersonMap[`${resource._uuid}`]) { return patientToPersonMap[`${resource._uuid}`]; }
        }
        return undefined;
    }

    /**
     * parses original proxy patient from original args
     * @param {ParsedArgs} parsedArgs
     * @return {{proxyPatientPersonId: (string|null), proxyPatientPersonIdKey: null}}
     */
    getProxyPatientFromArgs ({ parsedArgs }) {
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
                 * @type {string[]|null}
                 */
                const values = parsedArgsItem.queryParameterValue.values;
                if (values) {
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
        }
        return { proxyPatientPersonId, proxyPatientPersonIdKey };
    }

    /**
     * Runs any registered enrichment providers
     * @param {ParsedArgs} parsedArgs
     * @param {BundleEntry[]} entries
     * @return {Promise<BundleEntry[]>}
     */
    async enrichBundleEntriesAsync ({ entries, parsedArgs }) {
        for (const entry of entries) {
            if (entry.resource) {
                entry.resource = (await this.enrichAsync(
                    {
                        resources: [entry.resource],
                        parsedArgs
                    }
                ))[0];
                entry.id = entry.resource.id;
            }
        }
        return entries;
    }

    /**
     * Get function to update references
     * @param proxyPatientIds {string[]}
     * @param proxyPatientPersonId {string|null}
     * @returns {function(*): {reference}|*}
     */
    getUpdateReferenceFn (proxyPatientIds, proxyPatientPersonId) {
        return (reference) => {
            if (reference.reference && proxyPatientIds.includes(reference.reference)) {
                reference.reference = proxyPatientPersonId.startsWith('Patient/') ?
                    proxyPatientPersonId : `Patient/${proxyPatientPersonId}`;
            }
            return reference;
        };
    }
}

module.exports = {
    ProxyPatientReferenceEnrichmentProvider
};
