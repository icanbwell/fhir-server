'use strict';

const { EnrichmentProvider } = require('./enrichmentProvider');
const { logDebug, logError } = require('../../operations/common/logging');
const { HEADERS } = require('../../constants/mongoGroupMemberConstants');

/**
 * Enrichment provider for MongoDB Direct Group Members (V2)
 *
 * Same responsibilities as MongoGroupMemberEnrichmentProvider (V1):
 * - Strip `member` array from Group resources
 * - Populate `quantity` field with member count
 *
 * Difference: Uses countDocuments on direct collection (no view)
 */
class MongoDirectGroupMemberEnrichmentProvider extends EnrichmentProvider {
    /**
     * @param {Object} params
     * @param {import('../../dataLayer/repositories/mongoDirectGroupMemberRepository').MongoDirectGroupMemberRepository} params.mongoDirectGroupMemberRepository
     * @param {import('../../utils/configManager').ConfigManager} params.configManager
     */
    constructor({ mongoDirectGroupMemberRepository, configManager }) {
        super();
        this.repository = mongoDirectGroupMemberRepository;
        this.configManager = configManager;
    }

    isEnabled() {
        return this.configManager.enableMongoDirectGroupMembers;
    }

    _isRequestActivated(parsedArgs) {
        return parsedArgs?.headers?.[HEADERS.DIRECT_GROUP_MEMBER_REQUEST] === 'true';
    }

    /**
     * Enrich Group resources: remove member array, add quantity
     * @param {Object} params
     * @param {Resource[]} params.resources
     * @param {ParsedArgs} params.parsedArgs
     * @returns {Promise<Resource[]>}
     */
    async enrichAsync({ resources, parsedArgs }) {
        if (!this.isEnabled() || !this._isRequestActivated(parsedArgs)) {
            return resources;
        }

        const groupResources = resources.filter(r => r.resourceType === 'Group');
        if (groupResources.length === 0) {
            return resources;
        }

        for (const resource of groupResources) {
            try {
                const count = await this.repository.getActiveMemberCount(resource._uuid);
                resource.member = undefined;
                resource.quantity = count;

                logDebug('Enriched Group with direct member count', {
                    groupId: resource.id,
                    quantity: count
                });
            } catch (error) {
                logError('Error enriching Group with direct member count', {
                    groupId: resource.id,
                    error: error.message
                });
            }
        }

        return resources;
    }
}

module.exports = { MongoDirectGroupMemberEnrichmentProvider };
