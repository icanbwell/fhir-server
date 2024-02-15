const {EnrichmentProvider} = require('./enrichmentProvider');

class HiddenMetaTagEnrichmentProvider extends EnrichmentProvider {
    /**
     * enrich the specified resources
     * @param {Resource[]} resources
     * @param {ParsedArgs} parsedArgs
     * @return {Promise<Resource[]>}
     */
    // eslint-disable-next-line no-unused-vars
    async enrichAsync ({resources, parsedArgs}) {
        // if id is specified, return all resources
        if (parsedArgs.id) {
            return resources;
        }
        // skip resources that have the meta.tag of
        // system=https://fhir.icanbwell.com/4_0_0/CodeSystem/server-behavior
        // code=hidden
        return resources.filter(resource => {
            return !resource.meta || !resource.meta.tag || !resource.meta.tag.some(tag => {
                return tag.system === 'https://fhir.icanbwell.com/4_0_0/CodeSystem/server-behavior' &&
                    tag.code === 'hidden';
            });
        });
    }

    // eslint-disable-next-line no-unused-vars
    async enrichBundleEntriesAsync ({entries, parsedArgs}) {
        // if id is specified, return all resources
        if (parsedArgs.id) {
            return entries;
        }
        // skip resources that have the meta.tag of
        // system=https://fhir.icanbwell.com/4_0_0/CodeSystem/server-behavior
        // code=hidden
        return entries.filter(
            entry => !entry.resource ||
                !entry.resource.meta ||
                !entry.resource.meta.tag ||
                !entry.resource.meta.tag.some(tag => {
                    return tag.system === 'https://fhir.icanbwell.com/4_0_0/CodeSystem/server-behavior' &&
                        tag.code === 'hidden';
                })
        );
    }
}

module.exports = {
    HiddenMetaTagEnrichmentProvider
};
