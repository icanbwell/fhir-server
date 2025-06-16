const { EnrichmentProvider } = require('./enrichmentProvider');
const { isUuid, generateUUIDv5 } = require('../../utils/uid.util');
const { ReferenceParser } = require('../../utils/referenceParser');
const { resourceReferenceUpdater } = require('../../utils/resourceUpdater');
const { SUBSCRIPTION_RESOURCES_REFERENCE_SYSTEM } = require('../../constants')


/**
 * @classdesc sets id to global id if the 'Prefer' header is set
 */
class GlobalIdEnrichmentProvider extends EnrichmentProvider {

    /**
     * enrich the specified resources
     * @param {Resource[]} resources
     * @param {ParsedArgs} parsedArgs
     * @return {Promise<Resource[]>}
     */

    async enrichAsync({ resources, parsedArgs }) {
        /**
         * @type {string}
         */
        const preferHeader = parsedArgs.headers &&
            (parsedArgs.headers.prefer || parsedArgs.headers.Prefer);
        if (preferHeader) {
            const parts = preferHeader.split('=');
            if (parts[0] === 'global_id' && parts.slice(-1)[0] === 'true') {
                for (const resource of resources) {
                    await this._preferGlobalIdInsideSelectedResources(resource);

                    if (resource.id && !isUuid(resource.id)) {
                        const uuid = resource._uuid;
                        if (uuid) {
                            resource.id = uuid;
                        }
                    }
                    if (resource.contained && resource.contained.length > 0) {
                        resource.contained = await this.enrichAsync(
                            {
                                resources: resource.contained,
                                parsedArgs
                            }
                        );
                    }
                    await resourceReferenceUpdater(resource, async (reference) => await this.updateReferenceAsync(
                        {
                            reference
                        }
                    ));
                }
            }
        }

        return resources;
    }

    async _preferGlobalIdInsideSelectedResources(resource) {
        const resourceType = resource.resourceType;
        /**
         * @type {string}
         */
        const sourceAssigningAuthority = resource._sourceAssigningAuthority;

        if (!resourceType || !resourceType.startsWith('Subscription') || !sourceAssigningAuthority) {
            return;
        }

        // update ids present inside extensions
        if (resource.extension && Array.isArray(resource.extension)) {
            resource.extension.forEach((ext) => {
                if (
                    [
                        SUBSCRIPTION_RESOURCES_REFERENCE_SYSTEM.patient,
                        SUBSCRIPTION_RESOURCES_REFERENCE_SYSTEM.person
                    ].includes(ext.url) &&
                    ext.valueString &&
                    !isUuid(ext.valueString)
                ) {
                    ext.valueString = generateUUIDv5(`${ext.valueString}|${sourceAssigningAuthority}`);
                }
            });
        }

        // update ids present in identifiers
        if (resource.identifier && Array.isArray(resource.identifier)) {
            resource.identifier.forEach((idnt) => {
                if (
                    [
                        SUBSCRIPTION_RESOURCES_REFERENCE_SYSTEM.patient,
                        SUBSCRIPTION_RESOURCES_REFERENCE_SYSTEM.person
                    ].includes(idnt.system) &&
                    idnt.value &&
                    !isUuid(idnt.value)
                ) {
                    idnt.value = generateUUIDv5(`${idnt.value}|${sourceAssigningAuthority}`);
                }
            });
        }
    }

    /**
     * updates references
     * @param {Reference} reference
     * @return {Promise<Reference>}
     */
    async updateReferenceAsync({ reference }) {
        if (reference.reference) {
            const { id } = ReferenceParser.parseReference(reference.reference);
            if (!isUuid(id) && reference._uuid) {
                reference.reference = reference._uuid;
            }
        }
        return reference;
    }

    /**
     * Runs any registered enrichment providers
     * @param {ParsedArgs} parsedArgs
     * @param {BundleEntry[]} entries
     * @return {Promise<BundleEntry[]>}
     */
    async enrichBundleEntriesAsync({ entries, parsedArgs }) {
        for (const entry of entries) {
            if (entry.resource) {
                entry.resource = (await this.enrichAsync(
                    {
                        resources: [entry.resource],
                        parsedArgs
                    }
                ))[0];
            }
            entry.id = entry.resource.id;
        }
        return entries;
    }
}

module.exports = {
    GlobalIdEnrichmentProvider
};
