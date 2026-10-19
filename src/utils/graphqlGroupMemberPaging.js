const { MONGO_GROUP_EXTENDED_FIELD } = require('./mongoGroupExtendedTag');
const { mongoQueryAndOptionsStringify } = require('./mongoQueryStringify');
const { createTooCostlyError } = require('./fhirErrorFactory');
const { BadRequestError } = require('./httpErrors');

/**
 * RequestSpecificCache map holding the GroupMember rows already reserved by this request
 */
const MEMBER_ROW_BUDGET_CACHE_NAME = 'GraphQLGroupMemberRowBudget';
const MEMBER_ROWS_RESERVED_KEY = 'reserved';

/**
 * Normalizes FHIR GraphQL list-navigation arguments for a roster page read from Mongo:
 * a missing _count and any _count above maxCount become maxCount, negatives are clamped to 0
 * (an empty page; the caller must not query Mongo with it, since limit 0 is unlimited there).
 * @param {{_offset: (number|null|undefined), _count: (number|null|undefined)}} [args]
 * @param {number} maxCount - configManager.graphqlGroupMemberMaxCount
 * @returns {{offset: number, count: number}}
 */
function getMemberPageWindow(args, maxCount) {
    const { _offset, _count } = args || {};
    const offset = _offset > 0 ? _offset : 0;
    const count = _count == null ? maxCount : Math.min(Math.max(_count, 0), maxCount);
    return { offset, count };
}

/**
 * FHIR GraphQL list navigation (_offset/_count) over an array that is already in memory.
 * No paging arguments returns the whole list.
 * @param {Object[]|undefined} list
 * @param {{_offset: (number|null|undefined), _count: (number|null|undefined)}} [args]
 * @returns {Object[]|undefined}
 */
function sliceList(list, args) {
    if (!Array.isArray(list)) {
        return list;
    }
    const { _offset, _count } = args || {};
    if (_offset == null && _count == null) {
        return list;
    }
    const start = _offset > 0 ? _offset : 0;
    // Clamp a negative _count to 0 (empty page) rather than leaking Array.slice negative-index
    // semantics; _count == null stays unbounded (return the rest).
    const safeCount = _count != null && _count < 0 ? 0 : _count;
    const end = safeCount != null ? start + safeCount : undefined;
    return list.slice(start, end);
}

/**
 * Reserves `count` GroupMember rows against the request-wide total of maxCount, so aliased
 * `member` fields, aliased root queries and lists of extended Groups cannot add up to more than
 * maxCount rows in one request.
 *
 * The page size is reserved before the read (not the rows it returns), so the outcome depends
 * only on the order resolvers are called in. Must be called before the resolver's first await.
 * State lives in RequestSpecificCache under the request's id, cleared when the response finishes.
 * @param {Object} context - GraphQL context ({container, fhirRequestInfo})
 * @param {number} count
 * @param {number} maxCount - configManager.graphqlGroupMemberMaxCount
 * @throws {BadRequestError} too-costly when the request's reserved rows would exceed maxCount
 */
function reserveMemberRows(context, count, maxCount) {
    const budget = context.container.requestSpecificCache.getMap({
        requestId: context.fhirRequestInfo?.requestId,
        name: MEMBER_ROW_BUDGET_CACHE_NAME
    });
    const reserved = (budget.get(MEMBER_ROWS_RESERVED_KEY) || 0) + count;
    if (reserved > maxCount) {
        const { message, options } = createTooCostlyError({
            actual: reserved,
            limit: maxCount,
            operation: 'GRAPHQL',
            customGuidance: 'For GraphQL: the _count values of all extended Group member fields ' +
                `in one request (${maxCount} each when omitted) must add up to at most ${maxCount}; ` +
                'pass a smaller member(_count) or fetch further pages with member(_offset, _count) ' +
                'in separate requests'
        });
        throw new BadRequestError({ message }, options);
    }
    budget.set(MEMBER_ROWS_RESERVED_KEY, reserved);
}

/**
 * Resolver body of GraphQL Group.member (v1 and v2).
 *
 * - Embedded Group (or extended storage off): the inline member[] of the document, with
 *   _offset/_count sliced in memory.
 * - Extended Group, however it was reached: one page of GroupMember_4_0_0 (never the full
 *   roster), at most configManager.graphqlGroupMemberMaxCount rows, counted against the same
 *   request-wide total (reserveMemberRows). An empty page (_count <= 0) returns [] without a read.
 * @param {Object} parent - the Group
 * @param {{_offset: (number|null|undefined), _count: (number|null|undefined)}} args
 * @param {Object} context - GraphQL context ({container, dataApi, fhirRequestInfo})
 * @returns {Promise<Object[]|undefined>}
 */
async function resolveGroupMemberAsync(parent, args, context) {
    const { configManager } = context.container;
    const isExtended = parent && parent[MONGO_GROUP_EXTENDED_FIELD] === true &&
        configManager.enableExtendedGroup;
    if (!isExtended) {
        return sliceList(parent ? parent.member : undefined, args);
    }
    const maxCount = configManager.graphqlGroupMemberMaxCount;
    const { offset, count } = getMemberPageWindow(args, maxCount);
    if (count === 0) {
        // Mongo treats limit 0 as no limit
        return [];
    }
    reserveMemberRows(context, count, maxCount);
    const page = await context.container.mongoGroupMemberRepository.getMemberPageAsync({
        base_version: '4_0_0',
        groupUuid: parent._uuid,
        offset,
        count
    });
    // same rule searchBundle applies to the bundle's own debug tags: only admin-scoped callers
    // see query internals
    if (
        context.dataApi.debugMode &&
        context.container.scopesValidator.isAdminScope({ scope: context.fhirRequestInfo?.scope })
    ) {
        context.dataApi.metaList.push({
            tag: [
                {
                    system: 'https://www.icanbwell.com/query',
                    display: mongoQueryAndOptionsStringify({
                        query: page.queryItem,
                        options: page.options
                    })
                },
                {
                    system: 'https://www.icanbwell.com/queryCollection',
                    code: page.queryItem.collectionName
                }
            ]
        });
    }
    return page.members;
}

module.exports = {
    resolveGroupMemberAsync,
    reserveMemberRows,
    getMemberPageWindow,
    sliceList
};
