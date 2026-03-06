const { TABLES, EVENT_TYPES } = require('../../../constants/clickHouseConstants');

/**
 * Query builder for ClickHouse Group member queries
 *
 * Consolidates all SQL query construction logic for the mongoWithClickHouseStorageProvider.
 * All methods return { query: string, query_params: Object } for parameterized execution.
 *
 * Uses FINAL modifier on materialized views to ensure read-after-write consistency.
 * Filters active members using: argMaxMerge(event_type) = 'added' AND argMaxMerge(inactive) = 0
 */
class QueryBuilder {
    /**
     * Builds query to find Groups containing a specific member
     * Supports pagination (seek cursor or offset) and security tag filtering
     *
     * @param {Object} params
     * @param {string} params.memberReference - Entity reference to search for (e.g., "Patient/123")
     * @param {string[]} params.accessTags - Access security tags for filtering
     * @param {string[]} params.ownerTags - Owner security tags for filtering
     * @param {number} params.limit - Page size
     * @param {string|null} params.afterGroupId - Seek cursor (group_id to start after)
     * @param {number} params.skip - Offset for numeric pagination (fallback)
     * @returns {{query: string, query_params: Object}}
     */
    static buildFindGroupsByMemberQuery({
        memberReference,
        accessTags = [],
        ownerTags = [],
        limit,
        afterGroupId = null,
        skip = 0
    }) {
        const whereClause = 'WHERE entity_reference = {memberReference:String}';
        const havingClause = this._buildActiveMemberHavingClause(accessTags, ownerTags);

        let query;
        const query_params = {
            memberReference,
            limit,
            ...(accessTags.length > 0 && { accessTags }),
            ...(ownerTags.length > 0 && { ownerTags })
        };

        if (afterGroupId) {
            // Seek cursor pagination - O(log n) at any depth
            query = `
                SELECT group_id
                FROM ${TABLES.GROUP_MEMBER_CURRENT_BY_ENTITY} FINAL
                ${whereClause}
                  AND group_id > {afterGroupId:String}
                GROUP BY group_id
                HAVING ${havingClause}
                ORDER BY group_id
                LIMIT {limit:UInt32}
            `;
            query_params.afterGroupId = afterGroupId;
        } else if (skip > 0) {
            // Numeric offset pagination - O(n) but simpler for tests
            query = `
                SELECT group_id
                FROM ${TABLES.GROUP_MEMBER_CURRENT_BY_ENTITY} FINAL
                ${whereClause}
                GROUP BY group_id
                HAVING ${havingClause}
                ORDER BY group_id
                LIMIT {limit:UInt32}
                OFFSET {skip:UInt32}
            `;
            query_params.skip = skip;
        } else {
            // No pagination params - first page
            query = `
                SELECT group_id
                FROM ${TABLES.GROUP_MEMBER_CURRENT_BY_ENTITY} FINAL
                ${whereClause}
                GROUP BY group_id
                HAVING ${havingClause}
                ORDER BY group_id
                LIMIT {limit:UInt32}
            `;
        }

        return { query, query_params };
    }

    /**
     * Builds count query for Groups containing a specific member
     * Matches filtering logic from findGroupsByMemberQuery
     *
     * @param {Object} params
     * @param {string} params.memberReference - Entity reference to search for
     * @param {string[]} params.accessTags - Access security tags for filtering
     * @param {string[]} params.ownerTags - Owner security tags for filtering
     * @returns {{query: string, query_params: Object}}
     */
    static buildCountGroupsByMemberQuery({
        memberReference,
        accessTags = [],
        ownerTags = []
    }) {
        const whereClause = 'WHERE entity_reference = {memberReference:String}';
        const havingClause = this._buildActiveMemberHavingClause(accessTags, ownerTags);

        const query = `
            SELECT count() as total
            FROM (
                SELECT group_id
                FROM ${TABLES.GROUP_MEMBER_CURRENT_BY_ENTITY} FINAL
                ${whereClause}
                GROUP BY group_id
                HAVING ${havingClause}
            )
        `;

        const query_params = {
            memberReference,
            ...(accessTags.length > 0 && { accessTags }),
            ...(ownerTags.length > 0 && { ownerTags })
        };

        return { query, query_params };
    }

    /**
     * Builds query for active members of a specific Group (roster query)
     * Supports seek cursor pagination via afterReference
     *
     * @param {Object} params
     * @param {string} params.groupId - Group ID to query
     * @param {number} params.limit - Page size
     * @param {string|null} params.afterReference - Seek cursor (entity_reference to start after)
     * @returns {{query: string, query_params: Object}}
     */
    static buildActiveMembers({ groupId, limit, afterReference = null }) {
        const cursorClause = afterReference
            ? 'AND entity_reference > {afterReference:String}'
            : '';

        const query = `
            SELECT
                entity_reference,
                entity_type,
                inactive
            FROM (
                SELECT
                    entity_reference,
                    argMaxMerge(entity_type) AS entity_type,
                    argMaxMerge(event_type)  AS event_type,
                    argMaxMerge(inactive)    AS inactive
                FROM ${TABLES.GROUP_MEMBER_CURRENT} FINAL
                WHERE group_id = {groupId:String}
                GROUP BY entity_reference
            )
            WHERE event_type = '${EVENT_TYPES.MEMBER_ADDED}'
              AND inactive = 0
              ${cursorClause}
            ORDER BY entity_reference
            LIMIT {limit:UInt32}
        `;

        const query_params = {
            groupId,
            limit,
            ...(afterReference && { afterReference })
        };

        return { query, query_params };
    }

    /**
     * Builds count query for active members of a specific Group
     *
     * @param {Object} params
     * @param {string} params.groupId - Group ID to query
     * @returns {{query: string, query_params: Object}}
     */
    static buildActiveMemberCount({ groupId }) {
        const query = `
            SELECT count() as count
            FROM (
                SELECT entity_reference
                FROM ${TABLES.GROUP_MEMBER_CURRENT} FINAL
                WHERE group_id = {groupId:String}
                GROUP BY entity_reference
                HAVING argMaxMerge(event_type) = '${EVENT_TYPES.MEMBER_ADDED}'
                   AND argMaxMerge(inactive) = 0
            )
        `;

        return { query, query_params: { groupId } };
    }

    /**
     * Builds HAVING clause for active member filtering with optional security tags
     *
     * Active members are those where:
     * - event_type = MEMBER_ADDED (not removed)
     * - inactive = 0 (not marked inactive)
     * - AND security tags match (if provided)
     *
     * @param {string[]} accessTags - Access security tags
     * @param {string[]} ownerTags - Owner security tags
     * @returns {string} HAVING clause (without "HAVING" keyword)
     * @private
     */
    static _buildActiveMemberHavingClause(accessTags, ownerTags) {
        const clauses = [
            `argMaxMerge(event_type) = '${EVENT_TYPES.MEMBER_ADDED}'`,
            `argMaxMerge(inactive) = 0`
        ];

        // Security tags are AggregateFunction columns, must filter in HAVING after argMaxMerge
        if (accessTags.length > 0) {
            clauses.push(`hasAny(argMaxMerge(access_tags), {accessTags:Array(String)})`);
        }
        if (ownerTags.length > 0) {
            clauses.push(`hasAny(argMaxMerge(owner_tags), {ownerTags:Array(String)})`);
        }

        return clauses.join(' AND ');
    }

}

module.exports = { QueryBuilder };
