const { EnrichmentProvider } = require('./enrichmentProvider');
const { isTrue } = require('../../utils/isTrue');
const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');
const Coding = require('../../fhir/classes/4_0_0/complex_types/coding');
const { IdentifierSystem } = require('../../utils/identifierSystem');

/**
 * @classdesc add _uuid as an elememt in meta.tag
 */
class MetaUuidEnrichmentProvider extends EnrichmentProvider {
    /**
     * enrich the specified resources
     * @param {Resource[]} resources
     * @param {ParsedArgs} parsedArgs
     * @return {Promise<Resource[]>}
     */

    async enrichAsync({ resources, parsedArgs }) {
        if (isTrue(parsedArgs._metaUuid)) {
            for (const resource of resources) {
                if (resource._uuid && resource.meta) {
                    /**
                     * @type {object[]}
                     */
                    let uuidTag = FhirResourceCreator.create(
                        {
                            system: IdentifierSystem.uuid,
                            code: resource._uuid
                        },
                        Coding
                    );
                    let tag = resource.meta.tag;
                    if (tag) {
                        tag.push(uuidTag);
                    } else {
                        resource.meta.tag = [uuidTag];
                    }
                }
                if (resource.contained && resource.contained.length > 0) {
                    resource.contained = await this.enrichAsync({
                        resources: resource.contained,
                        parsedArgs
                    });
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
    async enrichBundleEntriesAsync({ entries, parsedArgs }) {
        for (const entry of entries) {
            if (entry.resource) {
                entry.resource = (
                    await this.enrichAsync({
                        resources: [entry.resource],
                        parsedArgs
                    })
                )[0];
            }
            entry.id = entry.resource.id;
        }
        return entries;
    }
}

module.exports = {
    MetaUuidEnrichmentProvider
};
