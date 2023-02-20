const {isTrue} = require('../../utils/isTrue');
const {ReferenceParser} = require('../../utils/referenceParser');

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
    // eslint-disable-next-line no-unused-vars
    async enrichAsync({resources, parsedArgs}) {
        throw Error('Not Implemented');
    }

    /**
     * Runs any registered enrichment providers
     * @param {ParsedArgs} parsedArgs
     * @param {BundleEntry[]} entries
     * @return {Promise<BundleEntry[]>}
     */
    // eslint-disable-next-line no-unused-vars
    async enrichBundleEntriesAsync({entries, parsedArgs}) {
        /**
         * @type {boolean}
         */
        const hash_references = isTrue(parsedArgs['_hash_references']);
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
                    resource.updateReferences(
                        {
                            fnUpdateReference: (reference) => this.updateReference(
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
    }

    /**
     * updates references
     * @param {Reference} reference
     * @param {Set} resourceTypeAndIdSet
     * @return {Reference}
     */
    updateReference({reference, resourceTypeAndIdSet}) {
        if (reference.reference) {
            const {
                resourceType,
                id,
                sourceAssigningAuthority
            } = ReferenceParser.parseReference(reference.reference);
            if (resourceTypeAndIdSet.has(reference.reference)) {
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
