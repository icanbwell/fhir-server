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
     * Searches on entity_reference_uuid or entity_reference_source_id columns,
     * which are AggregateFunction columns filtered via HAVING with argMaxMerge().
     *
     * @param {Object} params
     * @param {string} [params.memberReferenceUuid] - UUID reference (e.g., "Patient/<uuidv5>")
     * @param {string} [params.memberReferenceSourceId] - Source ID reference (e.g., "Patient/123")
     * @param {string[]} params.accessTags - Access security tags for filtering
     * @param {string[]} params.ownerTags - Owner security tags for filtering
     * @param {number} params.limit - Page size
     * @param {string|null} params.afterGroupId - Seek cursor (group_id to start after)
     * @param {number} params.skip - Offset for numeric pagination (fallback)
     * @param {string[]|null} [params.requestedIds] - Requested `_id` constraint; when present, restricts results to these group ids so LIMIT applies after id filtering
     * @returns {{query: string, query_params: Object}}
     */
    static buildFindGroupsByMemberQuery({
        memberReferenceUuid,
        memberReferenceSourceId,
        accessTags = [],
        ownerTags = [],
        limit,
        afterGroupId = null,
        skip = 0,
        requestedIds = null
    }) {
        const havingClause = this._buildActiveMemberHavingClause(
            accessTags, ownerTags, memberReferenceUuid, memberReferenceSourceId
        );

        // Push any requested `_id` constraint into the SQL so LIMIT and ordering
        // apply to the id-filtered set, not before it. group_id is a plain column,
        // so it belongs in WHERE (combined with the pagination cursor via AND).
        const hasRequestedIds = Array.isArray(requestedIds) && requestedIds.length > 0;
        const requestedIdsPredicate = 'group_id IN ({requestedIds:Array(String)})';

        let query;
        const query_params = {
            memberReferenceUuid: memberReferenceUuid || '',
            memberReferenceSourceId: memberReferenceSourceId || '',
            limit,
            ...(accessTags.length > 0 && { accessTags }),
            ...(ownerTags.length > 0 && { ownerTags }),
            ...(hasRequestedIds && { requestedIds })
        };

        if (afterGroupId) {
            const whereClause = hasRequestedIds
                ? `WHERE group_id > {afterGroupId:String} AND ${requestedIdsPredicate}`
                : 'WHERE group_id > {afterGroupId:String}';
            query = `
                SELECT group_id
                FROM ${TABLES.GROUP_MEMBER_CURRENT_BY_ENTITY} FINAL
                ${whereClause}
                GROUP BY group_id, entity_reference
                HAVING ${havingClause}
                ORDER BY group_id
                LIMIT {limit:UInt32}
            `;
            query_params.afterGroupId = afterGroupId;
        } else if (skip > 0) {
            const whereClause = hasRequestedIds ? `WHERE ${requestedIdsPredicate}` : '';
            query = `
                SELECT group_id
                FROM ${TABLES.GROUP_MEMBER_CURRENT_BY_ENTITY} FINAL
                ${whereClause}
                GROUP BY group_id, entity_reference
                HAVING ${havingClause}
                ORDER BY group_id
                LIMIT {limit:UInt32}
                OFFSET {skip:UInt32}
            `;
            query_params.skip = skip;
        } else {
            const whereClause = hasRequestedIds ? `WHERE ${requestedIdsPredicate}` : '';
            query = `
                SELECT group_id
                FROM ${TABLES.GROUP_MEMBER_CURRENT_BY_ENTITY} FINAL
                ${whereClause}
                GROUP BY group_id, entity_reference
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
     * @param {string} [params.memberReferenceUuid] - UUID reference
     * @param {string} [params.memberReferenceSourceId] - Source ID reference
     * @param {string[]} params.accessTags - Access security tags for filtering
     * @param {string[]} params.ownerTags - Owner security tags for filtering
     * @param {string[]|null} [params.requestedIds] - Requested `_id` constraint; when present, restricts the count to these group ids so total matches the id-filtered result set
     * @returns {{query: string, query_params: Object}}
     */
    static buildCountGroupsByMemberQuery({
        memberReferenceUuid,
        memberReferenceSourceId,
        accessTags = [],
        ownerTags = [],
        requestedIds = null
    }) {
        const havingClause = this._buildActiveMemberHavingClause(
            accessTags, ownerTags, memberReferenceUuid, memberReferenceSourceId
        );

        // Mirror the find query: when an `_id` constraint is present, restrict the
        // counted set to those group ids so Bundle.total matches Bundle.entry.
        const hasRequestedIds = Array.isArray(requestedIds) && requestedIds.length > 0;
        const whereClause = hasRequestedIds ? 'WHERE group_id IN ({requestedIds:Array(String)})' : '';

        const query = `
            SELECT count() as total
            FROM (
                SELECT group_id
                FROM ${TABLES.GROUP_MEMBER_CURRENT_BY_ENTITY} FINAL
                ${whereClause}
                GROUP BY group_id, entity_reference
                HAVING ${havingClause}
            )
        `;

        const query_params = {
            memberReferenceUuid: memberReferenceUuid || '',
            memberReferenceSourceId: memberReferenceSourceId || '',
            ...(accessTags.length > 0 && { accessTags }),
            ...(ownerTags.length > 0 && { ownerTags }),
            ...(hasRequestedIds && { requestedIds })
        };

        return { query, query_params };
    }

    /**
     * Builds HAVING clause for active member filtering with optional security tags
     * and entity reference matching
     *
     * Active members are those where:
     * - event_type = MEMBER_ADDED (not removed)
     * - inactive = 0 (not marked inactive)
     * - AND entity_reference_uuid or entity_reference_source_id matches (if provided)
     * - AND security tags match (if provided)
     *
     * entity_reference_uuid and entity_reference_source_id are AggregateFunction columns,
     * so they must be filtered via argMaxMerge() in HAVING, not WHERE.
     *
     * @param {string[]} accessTags - Access security tags
     * @param {string[]} ownerTags - Owner security tags
     * @param {string} [memberReferenceUuid] - UUID reference to match
     * @param {string} [memberReferenceSourceId] - Source ID reference to match
     * @returns {string} HAVING clause (without "HAVING" keyword)
     * @private
     */
    static _buildActiveMemberHavingClause(accessTags, ownerTags, memberReferenceUuid, memberReferenceSourceId) {
        const clauses = [
            `argMaxMerge(event_type) = '${EVENT_TYPES.MEMBER_ADDED}'`,
            `argMaxMerge(inactive) = 0`
        ];

        // Entity reference filtering via AggregateFunction columns
        if (memberReferenceUuid) {
            clauses.push(`argMaxMerge(entity_reference_uuid) = {memberReferenceUuid:String}`);
        }
        if (memberReferenceSourceId) {
            clauses.push(`argMaxMerge(entity_reference_source_id) = {memberReferenceSourceId:String}`);
        }

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
