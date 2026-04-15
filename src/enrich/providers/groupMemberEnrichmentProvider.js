const { EnrichmentProvider } = require('./enrichmentProvider');
const { logDebug, logError } = require('../../operations/common/logging');
const { TABLES } = require('../../constants/clickHouseConstants');
const { QueryFragments } = require('../../utils/clickHouse/queryFragments');
const { USE_EXTERNAL_MEMBER_STORAGE_HEADER } = require('../../utils/contextDataBuilder');
const { isTrue } = require('../../utils/isTrue');

/**
 * Enrichment provider for Group resources using ClickHouse member storage
 *
 * Responsibilities:
 * - Strip `member` array from Group resources (members stored in ClickHouse)
 * - Populate `quantity` field with member count from ClickHouse
 *
 * Architecture:
 * - MongoDB stores Group metadata only (no member array)
 * - ClickHouse stores member events (event-sourced)
 * - API responses computed on-the-fly from ClickHouse
 */
class GroupMemberEnrichmentProvider extends EnrichmentProvider {
    /**
     * @param {Object} params
     * @param {import('../../utils/clickHouseClientManager').ClickHouseClientManager} params.clickHouseClientManager
     * @param {import('../../utils/configManager').ConfigManager} params.configManager
     */
    constructor({ clickHouseClientManager, configManager }) {
        super();
        this.clickHouseClientManager = clickHouseClientManager;
        this.configManager = configManager;
    }

    /**
     * Checks if ClickHouse is enabled for Group resources
     * @returns {boolean}
     */
    isEnabled() {
        return this.configManager.enableClickHouse &&
               this.configManager.mongoWithClickHouseResources.includes('Group');
    }

    /**
     * Enrich Group resources: remove member array, add quantity from ClickHouse
     * @param {Object} params
     * @param {Resource[]} params.resources
     * @param {ParsedArgs} params.parsedArgs
     * @returns {Promise<Resource[]>}
     */
    async enrichAsync({ resources, parsedArgs }) {
        if (!this.isEnabled()) {
            return resources;
        }

        // Skip enrichment if request did not opt into external member storage
        if (!isTrue(parsedArgs?.headers?.[USE_EXTERNAL_MEMBER_STORAGE_HEADER])) {
            return resources;
        }

        try {
            // Process each Group resource
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
            logError('Error in GroupMemberEnrichmentProvider.enrichAsync', {
                error: error.message,
                stack: error.stack
            });
            // On error, return resources unchanged
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
        if (!this.isEnabled()) {
            return entries;
        }

        if (!isTrue(parsedArgs?.headers?.[USE_EXTERNAL_MEMBER_STORAGE_HEADER])) {
            return entries;
        }

        try {
            // Process each bundle entry
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
            logError('Error in GroupMemberEnrichmentProvider.enrichBundleEntriesAsync', {
                error: error.message,
                stack: error.stack
            });
            // On error, return entries unchanged
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

            // Query ClickHouse for current member count
            const memberCount = await this._getMemberCount(groupId);

            logDebug('Enriching Group resource', {
                groupId,
                memberCount,
                hadMemberArray: !!resource.member
            });

            // Create enriched resource
            const enriched = { ...resource };

            // Remove member array (members are in ClickHouse, use internal API to access)
            delete enriched.member;

            // Set quantity field to member count
            enriched.quantity = memberCount;

            return enriched;
        } catch (error) {
            logError('Error enriching Group resource', {
                error: error.message,
                groupId: resource.id
            });
            // On error, at minimum strip member array
            const safeResource = { ...resource };
            delete safeResource.member;
            safeResource.quantity = 0;
            return safeResource;
        }
    }

    /**
     * Get current member count for a Group from ClickHouse
     * @param {string} groupId - Group ID
     * @returns {Promise<number>} Number of active members
     * @private
     */
    async _getMemberCount(groupId) {
        try {
            const query = `
                SELECT count() as count
                FROM (
                    SELECT
                        entity_reference,
                        ${QueryFragments.argMaxWithTieBreaker('event_type')} as latest_event_type
                    FROM ${TABLES.GROUP_MEMBER_EVENTS}
                    ${QueryFragments.whereGroupId('', true)}
                    ${QueryFragments.groupByEntityReference()}
                    HAVING ${QueryFragments.activeMembers()}
                )
            `;

            const rows = await this.clickHouseClientManager.queryAsync({
                query,
                query_params: { groupId }
            });

            logDebug('ClickHouse member count query result', {
                groupId,
                rowsLength: rows.length,
                firstRow: rows[0],
                count: rows.length > 0 ? rows[0].count : null,
                parsedCount: rows.length > 0 ? parseInt(rows[0].count) : 0
            });

            return rows.length > 0 ? parseInt(rows[0].count) : 0;
        } catch (error) {
            logError('Error querying member count from ClickHouse', {
                error: error.message,
                groupId
            });
            return 0;
        }
    }
}

module.exports = {
    GroupMemberEnrichmentProvider
};
