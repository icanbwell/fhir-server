const { MONGO_GROUP_EXTENDED_FIELD } = require('./mongoGroupExtendedTag');
const { mongoQueryAndOptionsStringify } = require('./mongoQueryStringify');
const { createTooCostlyError } = require('./fhirErrorFactory');
const { BadRequestError } = require('./httpErrors');

/**
 * GraphQL context property set once a request has read an extended Group roster page. The context
 * is created per request (getContext in graphqlServer.js / graphqlServerV2.js) and discarded with
 * it, so the flag needs no cleanup.
 */
const EXTENDED_MEMBER_READ_CONTEXT_KEY = 'extendedGroupMemberRead';

/**
 * Normalizes FHIR GraphQL list-navigation arguments for a roster page read from Mongo:
 * a missing _count and any _count above maxCount become maxCount, and negatives are clamped to 0
 * (an empty page; the caller must not query Mongo with it, since limit 0 is unlimited there).
 * @param {{_offset: (number|null|undefined), _count: (number|null|undefined)}} [args]
 * @param {number} maxCount - configManager.graphqlGroupMemberMaxCount
 * @returns {{offset: number, count: number}}
 */
function getMemberPageWindow(args, maxCount) {
    const { _offset, _count } = args || {};
    const offset = _offset > 0 ? _offset : 0;
    const count = Math.min(Math.max(_count ?? maxCount, 0), maxCount);
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
 * Claims the request's single extended Group roster page read. One read per request bounds both
 * memory (at most maxCount rows) and Mongo work (one, time-limited, skip), whatever the query
 * shape: aliased member fields, aliased root queries and lists of extended Groups all draw from it.
 *
 * Must be called before the resolver's first await, so concurrent resolvers of one request see it.
 * @param {Object} context - GraphQL context
 * @throws {BadRequestError} too-costly when the request has already read a roster page
 */
function claimExtendedMemberRead(context) {
    if (context[EXTENDED_MEMBER_READ_CONTEXT_KEY]) {
        const { options } = createTooCostlyError({
            actual: 2,
            limit: 1,
            operation: 'GRAPHQL',
            customGuidance: 'For GraphQL: read one extended Group member page per request; query ' +
                'that Group alone and fetch further pages with member(_offset, _count) in separate requests'
        });
        throw new BadRequestError(
            { message: 'Only one extended Group member page can be read per GraphQL request' },
            options
        );
    }
    context[EXTENDED_MEMBER_READ_CONTEXT_KEY] = true;
}

/**
 * Resolver body of GraphQL Group.member (v1 and v2).
 *
 * - Embedded Group (or extended storage off): the inline member[] of the document, with
 *   _offset/_count sliced in memory.
 * - Extended Group: one page of GroupMember_4_0_0 (never the full roster), at most
 *   configManager.graphqlGroupMemberMaxCount rows and configManager.mongoTimeout, and only one such
 *   page per request (claimExtendedMemberRead). An empty page (_count <= 0) returns [] without a read.
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
    const { offset, count } = getMemberPageWindow(args, configManager.graphqlGroupMemberMaxCount);
    if (count === 0) {
        // Mongo treats limit 0 as no limit
        return [];
    }
    claimExtendedMemberRead(context);
    const page = await context.container.mongoGroupMemberRepository.getMemberPageAsync({
        base_version: '4_0_0',
        groupUuid: parent._uuid,
        offset,
        count,
        maxTimeMS: configManager.mongoTimeout
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
    claimExtendedMemberRead,
    getMemberPageWindow,
    sliceList
};
