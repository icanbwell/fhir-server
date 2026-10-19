const { describe, test, expect, jest } = require('@jest/globals');
const { buildSchema, graphql } = require('graphql');
const {
    isSingleIdGroupRead,
    isSingleIdRequest,
    getMemberPageWindow,
    sliceList,
    resolveGroupMemberAsync
} = require('../../../utils/graphqlGroupMemberPaging');
const { GRAPHQL_GROUP_MEMBER_MAX_COUNT } = require('../../../constants');

// Minimal schema with the same shape as the generated ones: a root field returning GroupBundle,
// a Patient that references a Group, and a non-Group bundle.
const SCHEMA = buildSchema(`
    input SearchString { searchType: String value: String values: [String] contains: String }
    type GroupMember { n: Int }
    type Group { id: String member(_offset: Int, _count: Int): [GroupMember] }
    type GroupBundleEntry { resource: Group }
    type GroupBundle { entry: [GroupBundleEntry] }
    type Patient { group: Group }
    type PatientBundleEntry { resource: Patient }
    type PatientBundle { entry: [PatientBundleEntry] }
    type Query { groups(id: SearchString, _id: SearchString): GroupBundle patients(id: SearchString): PatientBundle }
`);

/**
 * Executes a query against SCHEMA and returns the GraphQLResolveInfo of every Group.member call,
 * keyed by its response path, so tests use the same info object Apollo would pass.
 */
async function captureMemberInfos(source, variableValues) {
    const infos = {};
    SCHEMA.getType('Group').getFields().member.resolve = (_parent, _args, _context, info) => {
        const keys = [];
        for (let p = info.path; p; p = p.prev) {
            keys.unshift(p.key);
        }
        infos[keys.join('.')] = info;
        return [];
    };
    const group = { id: 'g1' };
    const result = await graphql({
        schema: SCHEMA,
        source,
        variableValues,
        rootValue: {
            groups: () => ({ entry: [{ resource: group }] }),
            patients: () => ({ entry: [{ resource: { group } }] })
        }
    });
    expect(result.errors).toBeUndefined();
    return infos;
}

describe('graphqlGroupMemberPaging', () => {
    describe('isSingleIdGroupRead', () => {
        test('true for a root Group search naming one id', async () => {
            const infos = await captureMemberInfos('{ groups(id: { value: "g1" }) { entry { resource { member { n } } } } }');
            expect(isSingleIdGroupRead(infos['groups.entry.0.resource.member'])).toBe(true);
        });

        test('reads the id from a variable', async () => {
            const infos = await captureMemberInfos(
                'query ($id: String) { groups(id: { value: $id }) { entry { resource { member { n } } } } }',
                { id: 'g1' }
            );
            expect(isSingleIdGroupRead(infos['groups.entry.0.resource.member'])).toBe(true);
        });

        test('judges each aliased root field on its own arguments', async () => {
            const infos = await captureMemberInfos(`{
                a: groups(id: { value: "g1" }) { entry { resource { member { n } } } }
                b: groups(id: { values: ["g1", "g2"] }) { entry { resource { member { n } } } }
                c: groups { entry { resource { member { n } } } }
            }`);
            expect(isSingleIdGroupRead(infos['a.entry.0.resource.member'])).toBe(true);
            expect(isSingleIdGroupRead(infos['b.entry.0.resource.member'])).toBe(false);
            expect(isSingleIdGroupRead(infos['c.entry.0.resource.member'])).toBe(false);
        });

        test('aliased entry/resource fields still match', async () => {
            const infos = await captureMemberInfos('{ g: groups(id: { value: "g1" }) { e: entry { r: resource { m: member { n } } } } }');
            expect(isSingleIdGroupRead(infos['g.e.0.r.m'])).toBe(true);
        });

        test('false for a Group reached through another resource, even with a single-id root', async () => {
            const infos = await captureMemberInfos('{ patients(id: { value: "p1" }) { entry { resource { group { member { n } } } } } }');
            expect(isSingleIdGroupRead(infos['patients.entry.0.resource.group.member'])).toBe(false);
        });

        test('false without execution info', () => {
            expect(isSingleIdGroupRead(undefined)).toBe(false);
        });
    });

    describe('isSingleIdRequest', () => {
        test.each([
            ['v2 SearchString value', { id: { value: 'g1' } }],
            ['v2 SearchString one entry in values', { id: { values: ['g1'] } }],
            ['v1 id list of one', { id: ['g1'] }],
            ['v1 _id SearchString', { _id: { value: 'g1' } }],
            ['explicit string searchType', { id: { searchType: 'string', value: 'g1' } }]
        ])('true for %s', (_name, args) => {
            expect(isSingleIdRequest(args)).toBe(true);
        });

        test.each([
            ['no args', undefined],
            ['no id', { member: { value: 'Patient/1' } }],
            ['two values', { id: { values: ['g1', 'g2'] } }],
            ['value plus values', { id: { value: 'g1', values: ['g2'] } }],
            ['comma separated OR list', { id: { value: 'g1,g2' } }],
            ['v1 id list of two', { id: ['g1', 'g2'] }],
            ['empty value', { id: { value: '' } }],
            ['id and _id together', { id: ['g1'], _id: { value: 'g1' } }],
            ['missing modifier', { id: { missing: true } }],
            ['notEquals modifier', { id: { value: 'g1', notEquals: { value: 'g2' } } }],
            ['contains modifier', { id: { contains: 'g1' } }],
            ['non string searchType', { id: { searchType: 'token', value: 'g1' } }]
        ])('false for %s', (_name, args) => {
            expect(isSingleIdRequest(args)).toBe(false);
        });
    });

    describe('getMemberPageWindow', () => {
        test('uses the maximum page size when _count is omitted', () => {
            expect(getMemberPageWindow({})).toEqual({
                offset: 0,
                count: GRAPHQL_GROUP_MEMBER_MAX_COUNT
            });
            expect(getMemberPageWindow(undefined)).toEqual({
                offset: 0,
                count: GRAPHQL_GROUP_MEMBER_MAX_COUNT
            });
        });

        test('caps _count at the maximum', () => {
            expect(getMemberPageWindow({ _count: 5000000 }).count).toBe(GRAPHQL_GROUP_MEMBER_MAX_COUNT);
        });

        test('clamps negative _offset and _count to 0', () => {
            expect(getMemberPageWindow({ _offset: -5, _count: -1 })).toEqual({ offset: 0, count: 0 });
        });

        test('passes through an in-range window', () => {
            expect(getMemberPageWindow({ _offset: 20, _count: 10 })).toEqual({ offset: 20, count: 10 });
        });
    });

    describe('sliceList', () => {
        const list = ['a', 'b', 'c', 'd'];

        test('returns the whole list without paging args', () => {
            expect(sliceList(list, {})).toBe(list);
            expect(sliceList(list, undefined)).toBe(list);
        });

        test('slices by _offset and _count', () => {
            expect(sliceList(list, { _offset: 1, _count: 2 })).toEqual(['b', 'c']);
            expect(sliceList(list, { _offset: 2 })).toEqual(['c', 'd']);
            expect(sliceList(list, { _count: 1 })).toEqual(['a']);
        });

        test('negative _count is an empty page', () => {
            expect(sliceList(list, { _count: -3 })).toEqual([]);
        });

        test('passes a non-array through', () => {
            expect(sliceList(undefined, { _count: 1 })).toBeUndefined();
        });
    });

    describe('resolveGroupMemberAsync', () => {
        function buildContext({ enableExtendedGroup = true, debugMode = false, isAdmin = true } = {}) {
            const getMemberPageAsync = jest.fn().mockResolvedValue({
                members: [{ entity: { reference: 'Patient/1' } }],
                queryItem: { query: { groupUuid: 'g-uuid' }, collectionName: 'GroupMember_4_0_0' },
                options: { sort: { _uuid: 1 }, skip: 0, limit: 100 }
            });
            const getMemberCursorAsync = jest.fn();
            return {
                getMemberPageAsync,
                getMemberCursorAsync,
                context: {
                    fhirRequestInfo: { scope: isAdmin ? 'user/*.read admin/*.*' : 'user/*.read' },
                    container: {
                        configManager: { enableExtendedGroup },
                        mongoGroupMemberRepository: { getMemberPageAsync, getMemberCursorAsync },
                        scopesValidator: { isAdminScope: () => isAdmin }
                    },
                    dataApi: { debugMode, metaList: [] }
                }
            };
        }

        async function singleIdInfo() {
            const infos = await captureMemberInfos('{ groups(id: { value: "g1" }) { entry { resource { member { n } } } } }');
            return infos['groups.entry.0.resource.member'];
        }

        async function listInfo() {
            const infos = await captureMemberInfos('{ groups { entry { resource { member { n } } } } }');
            return infos['groups.entry.0.resource.member'];
        }

        test('embedded Group resolves the inline list and slices it', async () => {
            const { context, getMemberPageAsync } = buildContext();
            const parent = { _uuid: 'g-uuid', member: [{ n: 1 }, { n: 2 }, { n: 3 }] };
            const info = await singleIdInfo();

            expect(await resolveGroupMemberAsync(parent, {}, context, info)).toEqual(parent.member);
            expect(await resolveGroupMemberAsync(parent, { _offset: 1, _count: 1 }, context, info)).toEqual([{ n: 2 }]);
            expect(getMemberPageAsync).not.toHaveBeenCalled();
        });

        test('extended Group not read by a single id gets [] and no Mongo read', async () => {
            const { context, getMemberPageAsync } = buildContext();

            expect(await resolveGroupMemberAsync({ _uuid: 'g-uuid', _extended: true }, { _count: 10 }, context, await listInfo()))
                .toEqual([]);
            expect(getMemberPageAsync).not.toHaveBeenCalled();
        });

        test('extended Group read by a single id reads one clamped page, never the full cursor', async () => {
            const { context, getMemberPageAsync, getMemberCursorAsync } = buildContext();

            const result = await resolveGroupMemberAsync(
                { _uuid: 'g-uuid', _extended: true }, { _offset: 5, _count: 5000000 }, context, await singleIdInfo()
            );

            expect(result).toEqual([{ entity: { reference: 'Patient/1' } }]);
            expect(getMemberPageAsync).toHaveBeenCalledTimes(1);
            expect(getMemberPageAsync).toHaveBeenCalledWith({
                base_version: '4_0_0',
                groupUuid: 'g-uuid',
                offset: 5,
                count: GRAPHQL_GROUP_MEMBER_MAX_COUNT
            });
            expect(getMemberCursorAsync).not.toHaveBeenCalled();
        });

        test('extended Group with no paging args reads the maximum page size', async () => {
            const { context, getMemberPageAsync } = buildContext();

            await resolveGroupMemberAsync({ _uuid: 'g-uuid', _extended: true }, {}, context, await singleIdInfo());

            expect(getMemberPageAsync).toHaveBeenCalledWith(
                expect.objectContaining({ offset: 0, count: GRAPHQL_GROUP_MEMBER_MAX_COUNT })
            );
        });

        test('feature flag off: extended Group falls back to the document member (none)', async () => {
            const { context, getMemberPageAsync } = buildContext({ enableExtendedGroup: false });

            expect(await resolveGroupMemberAsync({ _uuid: 'g-uuid', _extended: true }, {}, context, await singleIdInfo()))
                .toBeUndefined();
            expect(getMemberPageAsync).not.toHaveBeenCalled();
        });

        test('_debug from an admin caller adds the GroupMember query to the response meta', async () => {
            const { context } = buildContext({ debugMode: true });

            await resolveGroupMemberAsync({ _uuid: 'g-uuid', _extended: true }, {}, context, await singleIdInfo());

            expect(context.dataApi.metaList).toHaveLength(1);
            const tags = context.dataApi.metaList[0].tag;
            expect(tags.find((t) => t.system === 'https://www.icanbwell.com/queryCollection').code)
                .toBe('GroupMember_4_0_0');
            expect(tags.find((t) => t.system === 'https://www.icanbwell.com/query').display)
                .toContain('db.GroupMember_4_0_0.find');
        });

        test('_debug from a non-admin caller adds no query tags', async () => {
            const { context } = buildContext({ debugMode: true, isAdmin: false });

            await resolveGroupMemberAsync({ _uuid: 'g-uuid', _extended: true }, {}, context, await singleIdInfo());

            expect(context.dataApi.metaList).toEqual([]);
        });
    });
});
