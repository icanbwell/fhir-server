const { TABLES, EVENT_TYPES } = require('../../../constants/clickHouseConstants');
const { ForbiddenError } = require('../../../utils/httpErrors');

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
     * @param {boolean} [params.hasFullAccess] - True when the caller holds a wildcard
     *   (access/*.*) scope and legitimately sees every tenant. When true, no tenant
     *   predicate is applied. See _buildActiveMemberHavingClause.
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
        hasFullAccess = false,
        limit,
        afterGroupId = null,
        skip = 0
    }) {
        // FINAL forces merge-on-read, which the synchronous write path needs for read-after-write
        // consistency (ClickHouse is the source of truth for membership). Cost caveat: FINAL merges
        // matching parts at query time, so it can get expensive for a member in very many groups or
        // under heavy insert pressure; if reverse-lookup latency regresses, revisit with a lighter
        // deduplicating read.
        const havingClause = this._buildActiveMemberHavingClause(
            accessTags, ownerTags, memberReferenceUuid, memberReferenceSourceId, hasFullAccess
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
     * @param {boolean} [params.hasFullAccess] - True when the caller holds a wildcard
     *   (access/*.*) scope and legitimately sees every tenant. When true, no tenant
     *   predicate is applied. See _buildActiveMemberHavingClause.
     * @returns {{query: string, query_params: Object}}
     */
    static buildCountGroupsByMemberQuery({
        memberReferenceUuid,
        memberReferenceSourceId,
        accessTags = [],
        ownerTags = [],
        hasFullAccess = false
    }) {
        const havingClause = this._buildActiveMemberHavingClause(
            accessTags, ownerTags, memberReferenceUuid, memberReferenceSourceId, hasFullAccess
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
     * TENANT ISOLATION (fail-closed, admin-exempt), mirroring SecurityTagManager. Authorization is
     * decided upstream, not inferred here from whether tags are present:
     *   - Full-access admin (access/*.*) → empty tags + hasFullAccess: no tenant predicate applied.
     *   - Scoped caller → filter by the caller's access/owner tags.
     *   - Unscoped non-admin (no tags, not full access) → ForbiddenError (403). Defense in depth:
     *     ScopesManager already 403s such a caller before the query is built.
     *
     * @param {string[]} accessTags - Access security tags
     * @param {string[]} ownerTags - Owner security tags
     * @param {string} [memberReferenceUuid] - UUID reference to match
     * @param {string} [memberReferenceSourceId] - Source ID reference to match
     * @param {boolean} [hasFullAccess] - True when the caller holds a wildcard scope
     * @returns {string} HAVING clause (without "HAVING" keyword)
     * @throws {ForbiddenError} When the caller is neither scoped nor full-access
     * @private
     */
    static _buildActiveMemberHavingClause(
        accessTags, ownerTags, memberReferenceUuid, memberReferenceSourceId, hasFullAccess = false
    ) {
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

        // Full/wildcard access: legitimately sees every tenant => no tenant predicate.
        if (hasFullAccess) {
            return clauses.join(' AND ');
        }

        // Genuinely unscoped (no tags and not full access): deny with a 403 rather
        // than leaking cross-tenant rows. Matches the write path, which throws on
        // empty tags.
        if (!hasAccessTags && !hasOwnerTags) {
            throw new ForbiddenError(
                'Cannot query Group members without an access scope: the caller has ' +
                'neither security tags nor full access. Denying to prevent cross-tenant access.'
            );
        }

        // Scoped caller: filter on the tags they carry.
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
