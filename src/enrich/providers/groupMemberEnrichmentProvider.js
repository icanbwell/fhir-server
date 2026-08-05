const { EnrichmentProvider } = require('./enrichmentProvider');
const { logDebug, logError } = require('../../operations/common/logging');
const { TABLES } = require('../../constants/clickHouseConstants');
const { QueryFragments } = require('../../utils/clickHouse/queryFragments');
const { USE_EXTERNAL_STORAGE_HEADER } = require('../../utils/contextDataBuilder');
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
     * @param {Object} params.enrichmentContext
     * @returns {Promise<Resource[]>}
     */
    async enrichAsync({ resources, parsedArgs, enrichmentContext }) {
        if (!this.isEnabled()) {
            return resources;
        }

        // Skip enrichment if request did not opt into external member storage
        if (!isTrue(parsedArgs?.headers?.[USE_EXTERNAL_STORAGE_HEADER])) {
            return resources;
        }

        // Extract security context for tenant filtering (defense in depth)
        const securityContext = enrichmentContext?.securityContext || {};

        try {
            // Process each Group resource
            const enrichedResources = await Promise.all(
                resources.map(async (resource) => {
                    if (resource.resourceType === 'Group') {
                        return await this._enrichGroupResource(resource, securityContext);
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
     * @param {Object} params.enrichmentContext
     * @returns {Promise<BundleEntry[]>}
     */
    async enrichBundleEntriesAsync({ entries, parsedArgs, enrichmentContext }) {
        if (!this.isEnabled()) {
            return entries;
        }

        if (!isTrue(parsedArgs?.headers?.[USE_EXTERNAL_STORAGE_HEADER])) {
            return entries;
        }

        // Extract security context for tenant filtering (defense in depth)
        const securityContext = enrichmentContext?.securityContext || {};

        try {
            // Process each bundle entry
            const enrichedEntries = await Promise.all(
                entries.map(async (entry) => {
                    if (entry.resource && entry.resource.resourceType === 'Group') {
                        entry.resource = await this._enrichGroupResource(entry.resource, securityContext);
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
     * @param {Object} securityContext - Caller tenant scope
     * @param {string[]} securityContext.accessTags - Access security tags
     * @param {string[]} securityContext.ownerTags - Owner security tags
     * @param {boolean} securityContext.hasFullAccess - True for admin/full-access callers
     * @returns {Promise<Object>} Enriched Group resource
     * @private
     */
    async _enrichGroupResource(resource, securityContext = {}) {
        try {
            const groupId = resource.id;

            // Query ClickHouse for current member count with tenant filtering
            const memberCount = await this._getMemberCount(groupId, securityContext);

            logDebug('Enriching Group resource', {
                groupId,
                memberCount,
                hadMemberArray: !!resource.member,
                hasSecurityContext: !!(securityContext.accessTags || securityContext.ownerTags || securityContext.hasFullAccess)
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
     * Get current member count for a Group from ClickHouse with tenant filtering
     * @param {string} groupId - Group ID
     * @param {Object} securityContext - Caller tenant scope
     * @param {string[]} securityContext.accessTags - Access security tags
     * @param {string[]} securityContext.ownerTags - Owner security tags
     * @param {boolean} securityContext.hasFullAccess - True for admin/full-access callers
     * @returns {Promise<number>} Number of active members
     * @private
     */
    async _getMemberCount(groupId, securityContext = {}) {
        try {
            const { accessTags = [], ownerTags = [], hasFullAccess = false } = securityContext;

            // Build HAVING clause with tenant filtering (defense in depth)
            // MongoDB already filtered unauthorized Groups, but ClickHouse enforces tenant scope too
            const havingClauses = [
                `argMaxMerge(event_type) = 'MEMBER_ADDED'`,
                `argMaxMerge(inactive) = 0`
            ];

            // Add tenant filtering: hasAny(argMaxMerge(access_tags), ...) for non-admin callers
            // Admin (hasFullAccess) bypasses tag filtering
            if (!hasFullAccess) {
                if (accessTags.length > 0) {
                    havingClauses.push(`hasAny(argMaxMerge(access_tags), {accessTags:Array(String)})`);
                }
                if (ownerTags.length > 0) {
                    havingClauses.push(`hasAny(argMaxMerge(owner_tags), {ownerTags:Array(String)})`);
                }
            }

            const havingClause = havingClauses.join(' AND ');

            // Use GROUP_MEMBER_CURRENT materialized view (more efficient than GROUP_MEMBER_EVENTS)
            // FINAL ensures we see the most recent merged state
            const query = `
                SELECT count() as count
                FROM (
                    SELECT entity_reference
                    FROM ${TABLES.GROUP_MEMBER_CURRENT} FINAL
                    WHERE group_id = {groupId:String}
                    GROUP BY entity_reference
                    HAVING ${havingClause}
                )
            `;

            const query_params = {
                groupId,
                ...(accessTags.length > 0 && { accessTags }),
                ...(ownerTags.length > 0 && { ownerTags })
            };

            const rows = await this.clickHouseClientManager.queryAsync({
                query,
                query_params
            });

            logDebug('ClickHouse member count query result', {
                groupId,
                rowsLength: rows.length,
                firstRow: rows[0],
                count: rows.length > 0 ? rows[0].count : null,
                parsedCount: rows.length > 0 ? parseInt(rows[0].count) : 0,
                hasSecurityContext: !!(accessTags.length || ownerTags.length || hasFullAccess),
                accessTagsCount: accessTags.length,
                ownerTagsCount: ownerTags.length,
                hasFullAccess
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
