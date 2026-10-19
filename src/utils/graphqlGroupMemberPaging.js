const { GRAPHQL_GROUP_MEMBER_MAX_COUNT } = require('../constants');
const { MONGO_GROUP_EXTENDED_FIELD } = require('./mongoGroupExtendedTag');
const { mongoQueryAndOptionsStringify } = require('./mongoQueryStringify');
const { getArgumentValues, getNamedType } = require('graphql');

/**
 * Collects the id values of a SearchString argument, or null when the argument uses anything
 * besides plain equality (missing/above/below/notEquals/contains/...), which can widen the match.
 * @param {Object|string[]|undefined} idArg
 * @returns {string[]|null}
 */
function getPlainIdValues(idArg) {
    if (Array.isArray(idArg)) {
        return idArg;
    }
    const { searchType, value, values, ...rest } = idArg;
    const usesOtherOperators = Object.values(rest).some((v) => v !== undefined && v !== null);
    if (usesOtherOperators || (searchType && searchType !== 'string')) {
        return null;
    }
    const collected = [];
    if (value !== undefined && value !== null) {
        collected.push(value);
    }
    if (Array.isArray(values)) {
        collected.push(...values);
    }
    return collected;
}

/**
 * True when a GraphQL Group query names exactly one Group by id: the v1 `id: [String]` list or the
 * `id` / `_id` SearchString holds one plain value (no comma-separated OR list).
 * @param {Object} args - the root query arguments
 * @returns {boolean}
 */
function isSingleIdRequest(args) {
    if (!args) {
        return false;
    }
    const idArgs = [args.id, args._id].filter((arg) => arg !== undefined && arg !== null);
    if (idArgs.length !== 1) {
        return false;
    }
    const values = getPlainIdValues(idArgs[0]);
    return Boolean(values) && values.length === 1 &&
        typeof values[0] === 'string' && values[0].length > 0 && !values[0].includes(',');
}

/**
 * Normalizes FHIR GraphQL list-navigation arguments for a roster page read from Mongo:
 * a missing _count and any _count above the maximum become the maximum page size, negatives are
 * clamped to 0.
 * @param {{_offset: (number|null|undefined), _count: (number|null|undefined)}} [args]
 * @returns {{offset: number, count: number}}
 */
function getMemberPageWindow(args) {
    const { _offset, _count } = args || {};
    const offset = _offset > 0 ? _offset : 0;
    const count = _count == null
        ? GRAPHQL_GROUP_MEMBER_MAX_COUNT
        : Math.min(Math.max(_count, 0), GRAPHQL_GROUP_MEMBER_MAX_COUNT);
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
 * True when this Group.member call sits directly under a root Group search that names exactly one
 * Group by id: `<root>.entry[i].resource.member`, where <root> is a root field returning
 * GroupBundle (v1 `group`, v2 `groups`) whose own arguments pass isSingleIdRequest.
 *
 * Decided from the resolver's own GraphQL execution info, so no request-scoped state is needed and
 * each aliased root field is judged on its own arguments. Groups reached any other way (a
 * reference, federation, a Group nested under another resource) never match the path shape.
 *
 * The path is matched on each level's parent type (`typename`), not its key: keys are response
 * keys, so `e: entry { r: resource { ... } }` would otherwise fail the match. GroupBundle has one
 * field of type [GroupBundleEntry] (`entry`) and GroupBundleEntry one of type Group (`resource`).
 * @param {import('graphql').GraphQLResolveInfo} info
 * @returns {boolean}
 */
function isSingleIdGroupRead(info) {
    const resourcePath = info && info.path && info.path.prev;
    const indexPath = resourcePath && resourcePath.prev;
    const entryPath = indexPath && indexPath.prev;
    const rootPath = entryPath && entryPath.prev;
    if (
        !rootPath || rootPath.prev ||
        resourcePath.typename !== 'GroupBundleEntry' ||
        typeof indexPath.key !== 'number' ||
        entryPath.typename !== 'GroupBundle' ||
        rootPath.typename !== info.schema.getQueryType().name
    ) {
        return false;
    }
    const rootNode = info.operation.selectionSet.selections.find(
        (selection) => selection.kind === 'Field' &&
            (selection.alias ? selection.alias.value : selection.name.value) === rootPath.key
    );
    if (!rootNode) {
        return false;
    }
    const rootField = info.schema.getQueryType().getFields()[rootNode.name.value];
    if (!rootField || getNamedType(rootField.type).name !== 'GroupBundle') {
        return false;
    }
    return isSingleIdRequest(getArgumentValues(rootField, rootNode, info.variableValues));
}

/**
 * Resolver body of GraphQL Group.member (v1 and v2).
 *
 * - Embedded Group (or extended storage off): the inline member[] of the document, with
 *   _offset/_count sliced in memory.
 * - Extended Group read by a single id: one page of GroupMember_4_0_0 (never the full roster).
 * - Extended Group reached any other way (list, multi-id, filter, reference): [] -- the roster
 *   is only served for an explicit single-Group read (isSingleIdGroupRead).
 * @param {Object} parent - the Group
 * @param {{_offset: (number|null|undefined), _count: (number|null|undefined)}} args
 * @param {Object} context - GraphQL context ({container, dataApi, fhirRequestInfo})
 * @param {import('graphql').GraphQLResolveInfo} info
 * @returns {Promise<Object[]|undefined>}
 */
async function resolveGroupMemberAsync(parent, args, context, info) {
    const isExtended = parent && parent[MONGO_GROUP_EXTENDED_FIELD] === true &&
        context.container.configManager.enableExtendedGroup;
    if (!isExtended) {
        return sliceList(parent ? parent.member : undefined, args);
    }
    if (!isSingleIdGroupRead(info)) {
        return [];
    }
    const { offset, count } = getMemberPageWindow(args);
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
    isSingleIdGroupRead,
    isSingleIdRequest,
    getMemberPageWindow,
    sliceList
};
