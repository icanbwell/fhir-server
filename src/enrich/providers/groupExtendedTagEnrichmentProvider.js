const { EnrichmentProvider } = require('./enrichmentProvider');
const { isGroupExtended, addExtendedTagIfNeeded } = require('../../utils/mongoGroupExtendedTag');

class GroupExtendedTagEnrichmentProvider extends EnrichmentProvider {
    /**
     * @param {Resource[]} resources
     * @return {Promise<Resource[]>}
     */
    async enrichAsync ({ resources }) {
        for (const resource of resources) {
            if (resource?.resourceType === 'Group' && isGroupExtended(resource)) {
                addExtendedTagIfNeeded(resource);
            }
        }
        return resources;
    }

    /**
     * @param {BundleEntry[]} entries
     * @return {Promise<BundleEntry[]>}
     */
    async enrichBundleEntriesAsync ({ entries }) {
        for (const entry of entries) {
            if (entry.resource) {
                [entry.resource] = await this.enrichAsync({ resources: [entry.resource] });
            }
        }
        return entries;
    }
}

module.exports = {
    GroupExtendedTagEnrichmentProvider
};
