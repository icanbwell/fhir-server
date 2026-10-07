'use strict';

const { describe, test, expect, jest } = require('@jest/globals');
const { GroupMemberQueryRewriter } = require('../../../queryRewriters/rewriters/groupMemberQueryRewriter');
const { ConfigManager } = require('../../../utils/configManager');
const { MongoGroupMemberRepository } = require('../../../dataLayer/repositories/mongoGroupMemberRepository');
const { R4SearchQueryCreator } = require('../../../operations/query/r4');
const { AccessIndexManager } = require('../../../operations/common/accessIndexManager');
const { R4ArgsParser } = require('../../../operations/query/r4ArgsParser');
const { ParsedArgs } = require('../../../operations/query/parsedArgs');
const { ParsedArgsItem } = require('../../../operations/query/parsedArgsItem');
const { QueryParameterValue } = require('../../../operations/query/queryParameterValue');
const { SearchParameterDefinition } = require('../../../searchParameters/searchParameterTypes');

const HIDDEN_TAG = { 'meta.tag': { $not: { $elemMatch: { code: 'hidden' } } } };
const UUID_LEAF = { 'member.entity._uuid': { $in: ['Patient/u1'] } };
// FilterByReference output for member=Patient/<uuid>
const UUID_MEMBER = { $or: [{ $or: [UUID_LEAF] }] };

function makeRewriter ({ enableExtendedGroup = true, lookup = async () => ['group-1'] } = {}) {
    const configManager = Object.create(ConfigManager.prototype);
    Object.defineProperty(configManager, 'enableExtendedGroup', { value: enableExtendedGroup, configurable: true });
    const mongoGroupMemberRepository = Object.create(MongoGroupMemberRepository.prototype);
    mongoGroupMemberRepository.findGroupUuidsByMemberQueryAsync = jest.fn(async ({ query }) => lookup(query));
    return new GroupMemberQueryRewriter({ configManager, mongoGroupMemberRepository });
}

function rewrite (rewriter, query, { resourceType = 'Group', columns = new Set(['member.entity._uuid']) } = {}) {
    return rewriter.rewriteQueryAsync({ base_version: '4_0_0', query, columns, resourceType });
}

const extended = (condition, uuids = ['group-1']) => ({ $or: [condition, { _uuid: { $in: uuids } }] });

describe('GroupMemberQueryRewriter', () => {
    test('widens a member condition with the extended Groups whose GroupMember rows match it', async () => {
        const rewriter = makeRewriter();

        const { query, columns } = await rewrite(rewriter, { $and: [UUID_MEMBER, HIDDEN_TAG] });

        expect(query).toEqual({ $and: [{ $or: [{ $or: [extended(UUID_LEAF)] }] }, HIDDEN_TAG] });
        expect(rewriter.mongoGroupMemberRepository.findGroupUuidsByMemberQueryAsync)
            .toHaveBeenCalledWith({ base_version: '4_0_0', query: UUID_LEAF });
        expect(columns.has('_uuid')).toBe(true);
    });

    test('widens each member condition of an $and on its own (search param AND patient scope)', async () => {
        const leafB = { 'member.entity._uuid': { $in: ['Patient/u2'] } };
        const rewriter = makeRewriter({
            lookup: async (q) => (JSON.stringify(q) === JSON.stringify(leafB) ? ['group-b'] : ['group-a'])
        });

        const { query } = await rewrite(rewriter, { $and: [UUID_LEAF, leafB] });

        expect(query).toEqual({ $and: [extended(UUID_LEAF, ['group-a']), extended(leafB, ['group-b'])] });
        expect(rewriter.mongoGroupMemberRepository.findGroupUuidsByMemberQueryAsync).toHaveBeenCalledTimes(2);
    });

    test('widens the leaves of a sourceAssigningAuthority AND sourceId reference independently', async () => {
        const saaLeaf = { 'member.entity._sourceAssigningAuthority': 'owner' };
        const sourceIdLeaf = { 'member.entity._sourceId': { $in: ['Patient/123'] } };
        const rewriter = makeRewriter();

        const { query } = await rewrite(rewriter, { $or: [{ $or: [{ $and: [saaLeaf, sourceIdLeaf] }] }] });

        expect(query).toEqual({ $or: [{ $or: [{ $and: [extended(saaLeaf), extended(sourceIdLeaf)] }] }] });
    });

    test('widens inside $nor so member:not also excludes extended Groups', async () => {
        const rewriter = makeRewriter();

        const { query } = await rewrite(rewriter, { $and: [{ $nor: [UUID_MEMBER] }, HIDDEN_TAG] });

        expect(query).toEqual({ $and: [{ $nor: [{ $or: [{ $or: [extended(UUID_LEAF)] }] }] }, HIDDEN_TAG] });
    });

    test('ANDs a widened condition with the other keys of the same object', async () => {
        const rewriter = makeRewriter();

        const { query } = await rewrite(rewriter, { ...UUID_LEAF, ...HIDDEN_TAG });

        expect(query).toEqual({ $and: [HIDDEN_TAG, extended(UUID_LEAF)] });
    });

    test('widens the patient-scope filter shape (member.entity._uuid $in patients)', async () => {
        const rewriter = makeRewriter();
        const patientFilter = { 'member.entity._uuid': { $in: ['Patient/u1', 'Patient/u2'] } };

        const { query } = await rewrite(rewriter, { $and: [patientFilter, HIDDEN_TAG] });

        expect(query).toEqual({ $and: [extended(patientFilter), HIDDEN_TAG] });
    });

    test('looks up an identical condition only once per query', async () => {
        const rewriter = makeRewriter();

        await rewrite(rewriter, { $and: [UUID_LEAF, HIDDEN_TAG, { $nor: [{ ...UUID_LEAF }] }] });

        expect(rewriter.mongoGroupMemberRepository.findGroupUuidsByMemberQueryAsync).toHaveBeenCalledTimes(1);
    });

    test.each([
        ['history-shaped paths', { 'resource.member.entity._uuid': { $in: ['Patient/u1'] } }],
        [':missing on member.entity', { 'member.entity': { $exists: false } }],
        [':missing on member', { member: { $exists: true } }],
        ['$elemMatch', { member: { $elemMatch: { 'entity._uuid': 'Patient/u1' } } }],
        ['no member condition', HIDDEN_TAG]
    ])('ignores %s', async (_name, input) => {
        const rewriter = makeRewriter();

        const { query } = await rewrite(rewriter, input);

        expect(query).toBe(input);
        expect(rewriter.mongoGroupMemberRepository.findGroupUuidsByMemberQueryAsync).not.toHaveBeenCalled();
    });

    test('returns the original query and columns when no GroupMember row matches', async () => {
        const rewriter = makeRewriter({ lookup: async () => [] });
        const input = { $and: [UUID_MEMBER, HIDDEN_TAG] };
        const inputColumns = new Set(['member.entity._uuid']);

        const { query, columns } = await rewrite(rewriter, input, { columns: inputColumns });

        expect(query).toBe(input);
        expect(columns).toBe(inputColumns);
    });

    test.each([
        ['the extended Group flag is off', { enableExtendedGroup: false }, 'Group'],
        ['the resource is not Group', {}, 'Patient']
    ])('leaves the query untouched when %s', async (_name, options, resourceType) => {
        const rewriter = makeRewriter(options);
        const input = { $and: [UUID_MEMBER, HIDDEN_TAG] };

        const { query } = await rewrite(rewriter, input, { resourceType });

        expect(query).toBe(input);
        expect(rewriter.mongoGroupMemberRepository.findGroupUuidsByMemberQueryAsync).not.toHaveBeenCalled();
    });
});

describe('GroupMemberQueryRewriter against the real FilterByReference output', () => {
    function buildRealGroupQuery (memberValue) {
        const configManager = Object.create(ConfigManager.prototype);
        Object.defineProperty(configManager, 'useAccessIndex', { value: false, configurable: true });
        const accessIndexManager = Object.create(AccessIndexManager.prototype);
        accessIndexManager.resourceHasAccessIndexForAccessCodes = () => false;
        const creator = new R4SearchQueryCreator({
            configManager,
            accessIndexManager,
            r4ArgsParser: Object.create(R4ArgsParser.prototype)
        });
        const memberArg = new ParsedArgsItem({
            queryParameter: 'member',
            queryParameterValue: new QueryParameterValue({ value: memberValue, operator: '$and' }),
            propertyObj: new SearchParameterDefinition({
                type: 'reference',
                field: 'member.entity',
                target: ['Patient', 'Practitioner']
            }),
            modifiers: []
        });
        return creator.buildR4SearchQuery({
            resourceType: 'Group',
            parsedArgs: new ParsedArgs({ base_version: '4_0_0', parsedArgItems: [memberArg] }),
            useHistoryTable: false,
            operation: 'READ',
            isUser: false
        }).query;
    }

    /** every `member.*` condition in the query, as `{ key: value }` */
    function collectMemberConditions (node, found = []) {
        if (Array.isArray(node)) {
            node.forEach((child) => collectMemberConditions(child, found));
        } else if (node && typeof node === 'object') {
            for (const [key, value] of Object.entries(node)) {
                if (key.startsWith('member.')) {
                    found.push({ [`${key}`]: value });
                } else {
                    collectMemberConditions(value, found);
                }
            }
        }
        return found;
    }

    test.each([
        ['a uuid reference', 'Patient/550e8400-e29b-41d4-a716-446655440000'],
        ['a bare id reference', 'Patient/123'],
        ['an id with owner (sourceAssigningAuthority)', 'Patient/123|owner'],
        ['several references', 'Patient/123,Patient/550e8400-e29b-41d4-a716-446655440000']
    ])('widens every member condition built for %s', async (_name, memberValue) => {
        const originalQuery = buildRealGroupQuery(memberValue);
        const originalConditions = collectMemberConditions(originalQuery);
        const distinctConditions = new Set(originalConditions.map((c) => JSON.stringify(c)));
        expect(originalConditions.length).toBeGreaterThan(0);
        const rewriter = makeRewriter({ lookup: async () => ['group-b'] });

        const { query } = await rewrite(rewriter, originalQuery);

        // every condition the real builder produced was recognised and looked up
        expect(rewriter.mongoGroupMemberRepository.findGroupUuidsByMemberQueryAsync)
            .toHaveBeenCalledTimes(distinctConditions.size);
        // and each one was widened with the extended-Group branch
        const widenedBranches = JSON.stringify(query).split('{"_uuid":{"$in":["group-b"]}}').length - 1;
        expect(widenedBranches).toBe(originalConditions.length);
    });
});
