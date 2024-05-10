const { isTrue } = require('../../utils/isTrue');
const { ReferenceParser } = require('../../utils/referenceParser');

/**
 * @classdesc This class replaces references with hashed references if the reference resource is also included
 */
class HashReferencesEnrichmentProvider {
    /**
     * enrich the specified resources
     * @param {Resource[]} resources
     * @param {ParsedArgs} parsedArgs
     * @return {Promise<Resource[]>}
     */

    async enrichAsync ({ resources, parsedArgs }) {
        /**
         * @type {boolean}
         */
        const hash_references = isTrue(parsedArgs._hash_references);
        if (hash_references) {
            for (const /** @type {Resource} */ resource of resources) {
                // collect set of included resources
                const resourceTypeAndIdSet = new Set();
                if (resource) {
                    resourceTypeAndIdSet.add(`${resource.resourceType}/${resource.id}`);
                    if (resource.contained && resource.contained.length > 0) {
                        for (const /** @type {Resource} */ containedResource of resource.contained) {
                            resourceTypeAndIdSet.add(`${containedResource.resourceType}/${containedResource.id}`);
                        }
                    }
                    await resource.updateReferencesAsync(
                        {
                            fnUpdateReferenceAsync: async (reference) => this.updateReferenceAsync(
                                {
                                    reference,
                                    resourceTypeAndIdSet
                                }
                            )
                        }
                    );
                }
            }
        }
        return resources;
    }

    /**
     * Runs any registered enrichment providers
     * @param {ParsedArgs} parsedArgs
     * @param {BundleEntry[]} entries
     * @return {Promise<BundleEntry[]>}
     */

    async enrichBundleEntriesAsync ({ entries, parsedArgs }) {
        /**
         * @type {boolean}
         */
        const hash_references = isTrue(parsedArgs._hash_references);
        if (hash_references) {
            for (const /** @type {BundleEntry} */ entry of entries) {
                // collect set of included resources
                const resourceTypeAndIdSet = new Set();
                /**
                 * @type {Resource}
                 */
                const resource = entry.resource;
                if (resource) {
                    resourceTypeAndIdSet.add(`${resource.resourceType}/${resource.id}`);
                    if (resource.contained && resource.contained.length > 0) {
                        for (const /** @type {Resource} */ containedResource of resource.contained) {
                            resourceTypeAndIdSet.add(`${containedResource.resourceType}/${containedResource.id}`);
                        }
                    }
                    await resource.updateReferencesAsync(
                        {
                            fnUpdateReferenceAsync: async (reference) => await this.updateReferenceAsync(
                                {
                                    reference,
                                    resourceTypeAndIdSet
                                }
                            )
                        }
                    );
                }
            }
        }

        return entries;
    }

    /**
     * updates references
     * @param {Reference} reference
     * @param {Set} resourceTypeAndIdSet
     * @return {Promise<Reference>}
     */
    async updateReferenceAsync ({ reference, resourceTypeAndIdSet }) {
        if (reference.reference) {
            const {
                resourceType,
                id,
                sourceAssigningAuthority
            } = ReferenceParser.parseReference(reference.reference);
            if (!id.startsWith('#') && resourceTypeAndIdSet.has(reference.reference)) {
                reference.reference = ReferenceParser.createReference(
                    {
                        resourceType,
                        id: `#${id}`,
                        sourceAssigningAuthority
                    }
                );
            }
        }
        return reference;
    }
}

module.exports = {
    HashReferencesEnrichmentProvider
};
