const { EnrichmentProvider } = require('./enrichmentProvider');
const { logDebug, logError } = require('../../operations/common/logging');
const { HEADERS } = require('../../constants/mongoGroupMemberConstants');

/**
 * Enrichment provider for Group resources using MongoDB member storage
 *
 * Same responsibilities as GroupMemberEnrichmentProvider (ClickHouse version):
 * - Strip `member` array from Group resources (members stored in event collection)
 * - Populate `quantity` field with member count from MongoDB view
 *
 * Activation requires BOTH:
 * 1. Global: configManager.enableMongoGroupMembers === true (env var)
 * 2. Per-request: header subGroupMemberRequest: true
 *
 * Without the header, Groups are returned as-is from MongoDB.
 * Only requests that explicitly opt in get enrichment, because only those
 * Groups had their members written to the separate event collection.
 */
class MongoGroupMemberEnrichmentProvider extends EnrichmentProvider {
    /**
     * @param {Object} params
     * @param {import('../../dataLayer/repositories/mongoGroupMemberRepository').MongoGroupMemberRepository} params.mongoGroupMemberRepository
     * @param {import('../../utils/configManager').ConfigManager} params.configManager
     */
    constructor({ mongoGroupMemberRepository, configManager }) {
        super();
        this.repository = mongoGroupMemberRepository;
        this.configManager = configManager;
    }

    /**
     * Checks if MongoDB group members feature is globally enabled
     * @returns {boolean}
     */
    isEnabled() {
        return this.configManager.enableMongoGroupMembers;
    }

    /**
     * Checks if the current request opted into MongoDB group member storage
     * @param {ParsedArgs} parsedArgs
     * @returns {boolean}
     * @private
     */
    _isRequestActivated(parsedArgs) {
        return parsedArgs?.headers?.[HEADERS.SUB_GROUP_MEMBER_REQUEST] === 'true';
    }

    /**
     * Enrich Group resources: remove member array, add quantity from MongoDB view
     * @param {Object} params
     * @param {Resource[]} params.resources
     * @param {ParsedArgs} params.parsedArgs
     * @returns {Promise<Resource[]>}
     */
    async enrichAsync({ resources, parsedArgs }) {
        if (!this.isEnabled() || !this._isRequestActivated(parsedArgs)) {
            return resources;
        }

        try {
            const enrichedResources = await Promise.all(
                resources.map(async (resource) => {
                    if (resource.resourceType === 'Group') {
                        return await this._enrichGroupResource(resource);
                    }
                    return resource;
                })
            );

            return enrichedResources;
        } catch (error) {
            logError('Error in MongoGroupMemberEnrichmentProvider.enrichAsync', {
                error: error.message,
                stack: error.stack
            });
            return resources;
        }
    }

    /**
     * Enrich Group resources in bundle entries
     * @param {Object} params
     * @param {BundleEntry[]} params.entries
     * @param {ParsedArgs} params.parsedArgs
     * @returns {Promise<BundleEntry[]>}
     */
    async enrichBundleEntriesAsync({ entries, parsedArgs }) {
        if (!this.isEnabled() || !this._isRequestActivated(parsedArgs)) {
            return entries;
        }

        try {
            const enrichedEntries = await Promise.all(
                entries.map(async (entry) => {
                    if (entry.resource && entry.resource.resourceType === 'Group') {
                        entry.resource = await this._enrichGroupResource(entry.resource);
                    }
                    return entry;
                })
            );

            return enrichedEntries;
        } catch (error) {
            logError('Error in MongoGroupMemberEnrichmentProvider.enrichBundleEntriesAsync', {
                error: error.message,
                stack: error.stack
            });
            return entries;
        }
    }

    /**
     * Enrich a single Group resource
     * @param {Object} resource - FHIR Group resource
     * @returns {Promise<Object>} Enriched Group resource
     * @private
     */
    async _enrichGroupResource(resource) {
        try {
            const groupId = resource.id;
            const memberCount = await this.repository.getActiveMemberCount(groupId);

            logDebug('Enriching Group resource [MongoDB]', {
                groupId,
                memberCount,
                hadMemberArray: !!resource.member
            });

            const enriched = { ...resource };
            delete enriched.member;
            enriched.quantity = memberCount;

            return enriched;
        } catch (error) {
            logError('Error enriching Group resource [MongoDB]', {
                error: error.message,
                groupId: resource.id
            });
            const safeResource = { ...resource };
            delete safeResource.member;
            safeResource.quantity = 0;
            return safeResource;
        }
    }
}

module.exports = {
    MongoGroupMemberEnrichmentProvider
};
