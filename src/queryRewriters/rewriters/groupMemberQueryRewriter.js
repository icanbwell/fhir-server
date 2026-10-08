const { QueryRewriter } = require('./queryRewriter');
const { assertTypeEquals } = require('../../utils/assertType');
const { ConfigManager } = require('../../utils/configManager');
const { MongoGroupMemberRepository } = require('../../dataLayer/repositories/mongoGroupMemberRepository');
const { MongoQuerySimplifier } = require('../../utils/mongoQuerySimplifier');

const MEMBER_FIELD_PREFIX = 'member.';
const EQUALITY_OPERATORS = ['$in', '$eq'];
const LOGICAL_OPERATORS = ['$and', '$or', '$nor'];

/**
 * @typedef {{groupUuids: string[], explainedQuery: import('./queryRewriter').AdditionalRewriteQuery|undefined}} GroupMemberLookup
 */

/**
 * `member.<path>: <scalar | {$in} | {$eq}>` -- the equality shapes FilterByReference and the
 * patient-scope filter produce, and that mean the same thing on a GroupMember_4_0_0 row.
 * @param {string} key
 * @param {*} value
 * @returns {boolean}
 */
function isMemberCondition (key, value) {
    if (!key.startsWith(MEMBER_FIELD_PREFIX) || Array.isArray(value)) {
        return false;
    }
    if (!MongoQuerySimplifier.isFilter(value)) {
        return value !== null && typeof value !== 'object';
    }
    const operators = Object.keys(value);
    return operators.length > 0 && operators.every((operator) => EQUALITY_OPERATORS.includes(operator));
}

/**
 * Makes Group `member` conditions match extended Groups too. An extended Group has no inline
 * member[]; its roster lives in GroupMember_4_0_0, one row per member, using the same
 * member.entity paths. Each member condition C in the query becomes
 *
 *   $or: [C, { _uuid: { $in: <groupUuid of every GroupMember_4_0_0 row matching C> } }]
 *
 * On an embedded Group every member condition is satisfied by any array element on its own, so
 * widening condition by condition keeps $and/$or/$nor semantics identical across both regimes.
 * The security filters already in the query stay ANDed around C, so they constrain both
 * branches; the lookup itself is unfiltered.
 *
 * Not handled: `member:missing` (`$exists` on member.entity) is left matching the inline array
 * only, and history queries (`resource.member.*` paths) are left untouched.
 */
class GroupMemberQueryRewriter extends QueryRewriter {
    /**
     * @param {Object} params
     * @param {ConfigManager} params.configManager
     * @param {MongoGroupMemberRepository} params.mongoGroupMemberRepository
     */
    constructor ({ configManager, mongoGroupMemberRepository }) {
        super();
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
        /**
         * @type {MongoGroupMemberRepository}
         */
        this.mongoGroupMemberRepository = mongoGroupMemberRepository;
        assertTypeEquals(mongoGroupMemberRepository, MongoGroupMemberRepository);
    }

    /**
     * @param {string} base_version
     * @param {import('mongodb').Document} query
     * @param {Set} columns
     * @param {string} resourceType
     * @param {import('../../operations/query/parsedArgs').ParsedArgs} [parsedArgs] only read, for `_debug` / `_explain`
     * @return {Promise<{query:import('mongodb').Document,columns:Set,additionalRewriteQueries:import('./queryRewriter').AdditionalRewriteQuery[]}>}
     */
    async rewriteQueryAsync ({ base_version, query, columns, resourceType, parsedArgs }) {
        if (resourceType !== 'Group' || !this.configManager.enableExtendedGroup || !MongoQuerySimplifier.isFilter(query)) {
            return { query, columns, additionalRewriteQueries: [] };
        }
        const explain = Boolean(parsedArgs?._debug || parsedArgs?._explain);
        const lookupsByCondition = new Map();
        const rewrittenQuery = await this.rewriteNodeAsync({
            base_version,
            node: query,
            lookupsByCondition,
            explain
        });
        // each distinct lookup is listed once, already explained in the pass that ran it
        const additionalRewriteQueries = [...lookupsByCondition.values()]
            .map((lookup) => lookup.explainedQuery)
            .filter(Boolean);
        if (rewrittenQuery === query) {
            return { query, columns, additionalRewriteQueries };
        }
        return {
            query: rewrittenQuery,
            columns: MongoQuerySimplifier.findColumnsInFilter({ filter: rewrittenQuery }),
            additionalRewriteQueries
        };
    }

    /**
     * @param {Object} params
     * @param {string} params.base_version
     * @param {*} params.node
     * @param {Map<string, GroupMemberLookup>} params.lookupsByCondition lookup query (JSON) -> its result
     * @param {boolean} params.explain also explain each lookup
     * @returns {Promise<*>} the same node when nothing under it changed
     */
    async rewriteNodeAsync ({ base_version, node, lookupsByCondition, explain }) {
        if (!MongoQuerySimplifier.isFilter(node)) {
            return node;
        }

        let changed = false;
        const rest = {};
        const widenedConditions = [];
        for (const [key, value] of Object.entries(node)) {
            if (isMemberCondition(key, value)) {
                const condition = { [`${key}`]: value };
                const widened = await this.widenMemberConditionAsync({ base_version, condition, lookupsByCondition, explain });
                if (widened === condition) {
                    rest[`${key}`] = value;
                } else {
                    widenedConditions.push(widened);
                }
            } else if (LOGICAL_OPERATORS.includes(key) && Array.isArray(value)) {
                const children = [];
                for (const child of value) {
                    const rewrittenChild = await this.rewriteNodeAsync({ base_version, node: child, lookupsByCondition, explain });
                    changed = changed || rewrittenChild !== child;
                    children.push(rewrittenChild);
                }
                rest[`${key}`] = children;
            } else {
                rest[`${key}`] = value;
            }
        }

        if (widenedConditions.length === 0) {
            return changed ? rest : node;
        }
        const hasRest = Object.keys(rest).length > 0;
        if (!hasRest && widenedConditions.length === 1) {
            return widenedConditions[0];
        }
        return { $and: [...(hasRest ? [rest] : []), ...widenedConditions] };
    }

    /**
     * @param {Object} params
     * @param {string} params.base_version
     * @param {import('mongodb').Document} params.condition single `member.*` condition
     * @param {Map<string, GroupMemberLookup>} params.lookupsByCondition
     * @param {boolean} params.explain
     * @returns {Promise<import('mongodb').Document>} the same condition when no extended Group matches
     */
    async widenMemberConditionAsync ({ base_version, condition, lookupsByCondition, explain }) {
        const cacheKey = JSON.stringify(condition);
        let lookup = lookupsByCondition.get(cacheKey);
        if (!lookup) {
            lookup = await this.mongoGroupMemberRepository.findGroupUuidsByMemberQueryAsync({
                base_version,
                query: condition,
                explain
            });
            lookupsByCondition.set(cacheKey, lookup);
        }
        if (lookup.groupUuids.length === 0) {
            return condition;
        }
        return { $or: [condition, { _uuid: { $in: lookup.groupUuids } }] };
    }
}

module.exports = {
    GroupMemberQueryRewriter
};
