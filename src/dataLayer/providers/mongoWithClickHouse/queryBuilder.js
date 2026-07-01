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
     * @returns {{query: string, query_params: Object}}
     */
    static buildFindGroupsByMemberQuery({
        memberReferenceUuid,
        memberReferenceSourceId,
        accessTags = [],
        ownerTags = [],
        limit,
        afterGroupId = null,
        skip = 0
    }) {
        // WATCH ITEM (read cost at scale): this reverse-lookup uses the FINAL
        // modifier on Group_4_0_0_MemberCurrentByEntity to force merge-on-read for
        // read-after-write consistency. FINAL merges all parts touching the matched
        // rows at query time; for a member that belongs to a very large number of
        // groups (or under heavy insert pressure with many unmerged parts) this can
        // become expensive. If reverse-lookup latency regresses, revisit: rely on
        // background merges + argMaxMerge instead of FINAL, or add a lighter
        // deduplicating read path. No behavior change intended here.
        const havingClause = this._buildActiveMemberHavingClause(
            accessTags, ownerTags, memberReferenceUuid, memberReferenceSourceId
        );

        let query;
        const query_params = {
            memberReferenceUuid: memberReferenceUuid || '',
            memberReferenceSourceId: memberReferenceSourceId || '',
            limit,
            ...(accessTags.length > 0 && { accessTags }),
            ...(ownerTags.length > 0 && { ownerTags })
        };

        if (afterGroupId) {
            query = `
                SELECT group_id
                FROM ${TABLES.GROUP_MEMBER_CURRENT_BY_ENTITY} FINAL
                WHERE group_id > {afterGroupId:String}
                GROUP BY group_id, entity_reference
                HAVING ${havingClause}
                ORDER BY group_id
                LIMIT {limit:UInt32}
            `;
            query_params.afterGroupId = afterGroupId;
        } else if (skip > 0) {
            query = `
                SELECT group_id
                FROM ${TABLES.GROUP_MEMBER_CURRENT_BY_ENTITY} FINAL
                GROUP BY group_id, entity_reference
                HAVING ${havingClause}
                ORDER BY group_id
                LIMIT {limit:UInt32}
                OFFSET {skip:UInt32}
            `;
            query_params.skip = skip;
        } else {
            query = `
                SELECT group_id
                FROM ${TABLES.GROUP_MEMBER_CURRENT_BY_ENTITY} FINAL
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
     * @returns {{query: string, query_params: Object}}
     */
    static buildCountGroupsByMemberQuery({
        memberReferenceUuid,
        memberReferenceSourceId,
        accessTags = [],
        ownerTags = []
    }) {
        const havingClause = this._buildActiveMemberHavingClause(
            accessTags, ownerTags, memberReferenceUuid, memberReferenceSourceId
        );

        const query = `
            SELECT count() as total
            FROM (
                SELECT group_id
                FROM ${TABLES.GROUP_MEMBER_CURRENT_BY_ENTITY} FINAL
                GROUP BY group_id, entity_reference
                HAVING ${havingClause}
            )
        `;

        const query_params = {
            memberReferenceUuid: memberReferenceUuid || '',
            memberReferenceSourceId: memberReferenceSourceId || '',
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
     * FAIL-CLOSED tenant isolation: if BOTH access and owner tags are absent,
     * the query is unscoped and would otherwise return rows across every tenant.
     * The write path (QueryFragments.whereAccessTags / whereOwnerTags) throws in
     * this case; the read path historically just omitted the filter, leaking
     * cross-tenant results for an empty-tag query. We instead inject a deny
     * clause ("1 = 0") so an unscoped read returns zero rows. A legitimately
     * scoped admin caller carries the wildcard access code, which arrives here
     * as a non-empty array (e.g. ['*']) and is therefore NOT blocked.
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

        const hasAccessTags = Array.isArray(accessTags) && accessTags.length > 0;
        const hasOwnerTags = Array.isArray(ownerTags) && ownerTags.length > 0;

        // Fail closed: no security scope at all => deny (return no rows) rather
        // than silently returning cross-tenant data.
        if (!hasAccessTags && !hasOwnerTags) {
            clauses.push('1 = 0');
            return clauses.join(' AND ');
        }

        // Security tags are AggregateFunction columns, must filter in HAVING after argMaxMerge
        if (hasAccessTags) {
            clauses.push(`hasAny(argMaxMerge(access_tags), {accessTags:Array(String)})`);
        }
        if (hasOwnerTags) {
            clauses.push(`hasAny(argMaxMerge(owner_tags), {ownerTags:Array(String)})`);
        }

        return clauses.join(' AND ');
    }

}

module.exports = { QueryBuilder };
