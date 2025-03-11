const { EnrichmentProvider } = require('./enrichmentProvider');
const { isUuid } = require('../../utils/uid.util');
const { ReferenceParser } = require('../../utils/referenceParser');
const { rawResourceReferenceUpdater } = require('../../utils/rawResourceUpdater');

/**
 * @classdesc sets id to global id if the 'Prefer' header is set
 */
class GlobalIdEnrichmentProvider extends EnrichmentProvider {

    /**
     * enrich the specified resources
     * @param {Resource[]} resources
     * @param {ParsedArgs} parsedArgs
     * @param {Boolean} rawResources
     * @return {Promise<Resource[]>}
     */

    async enrichAsync ({ resources, parsedArgs, rawResources = false }) {
        /**
         * @type {string}
         */
        const preferHeader = parsedArgs.headers &&
            (parsedArgs.headers.prefer || parsedArgs.headers.Prefer);
        if (preferHeader) {
            const parts = preferHeader.split('=');
            if (parts[0] === 'global_id' && parts.slice(-1)[0] === 'true') {
                for (const resource of resources) {
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
                                parsedArgs,
                                rawResources
                            }
                        );
                    }
                    if (resource.updateReferencesAsync) {
                        // update references
                        await resource.updateReferencesAsync(
                            {
                                fnUpdateReferenceAsync: async (reference) => await this.updateReferenceAsync(
                                    {
                                        reference
                                    }
                                )
                            }
                        );
                    } else if (rawResources) {
                        await rawResourceReferenceUpdater(resource, async (reference) => await this.updateReferenceAsync(
                            {
                                reference
                            }
                        ));
                    }
                }
            }
        }

        return resources;
    }

    /**
     * updates references
     * @param {Reference} reference
     * @return {Promise<Reference>}
     */
    async updateReferenceAsync ({ reference }) {
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
     * @param {Boolean} rawResources
     * @return {Promise<BundleEntry[]>}
     */
    async enrichBundleEntriesAsync ({ entries, parsedArgs, rawResources = false  }) {
        for (const entry of entries) {
            if (entry.resource) {
                entry.resource = (await this.enrichAsync(
                    {
                        resources: [entry.resource],
                        parsedArgs,
                        rawResources
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
