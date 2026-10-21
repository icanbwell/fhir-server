const { describe, test, expect, jest } = require('@jest/globals');
const {
    getMemberPageWindow,
    sliceList,
    resolveGroupMemberAsync,
    claimExtendedMemberRead
} = require('../../../utils/graphqlGroupMemberPaging');

// stands in for configManager.graphqlGroupMemberMaxCount (default 50000)
const MAX = 1000;
const MONGO_TIMEOUT = 120000;
const ONE_READ_MESSAGE = 'Only one extended Group member page can be read per GraphQL request';

describe('graphqlGroupMemberPaging', () => {
    describe('getMemberPageWindow', () => {
        test('uses the maximum page size when _count is omitted', () => {
            expect(getMemberPageWindow({}, MAX)).toEqual({ offset: 0, count: MAX });
            expect(getMemberPageWindow(undefined, MAX)).toEqual({ offset: 0, count: MAX });
        });

        test('caps _count at the maximum', () => {
            expect(getMemberPageWindow({ _count: 5000000 }, MAX).count).toBe(MAX);
        });

        test('_count 0 is an empty page', () => {
            expect(getMemberPageWindow({ _count: 0 }, MAX).count).toBe(0);
        });

        test('clamps negative _offset and _count to 0', () => {
            expect(getMemberPageWindow({ _offset: -5, _count: -1 }, MAX)).toEqual({ offset: 0, count: 0 });
        });

        test('passes through an in-range window', () => {
            expect(getMemberPageWindow({ _offset: 20, _count: 10 }, MAX)).toEqual({ offset: 20, count: 10 });
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

    describe('claimExtendedMemberRead', () => {
        test('the first claim in a request succeeds', () => {
            expect(() => claimExtendedMemberRead({})).not.toThrow();
        });

        test('a second claim in the same request is rejected with too-costly', () => {
            const context = {};
            claimExtendedMemberRead(context);

            let error;
            try {
                claimExtendedMemberRead(context);
            } catch (e) {
                error = e;
            }
            expect(error).toBeDefined();
            expect(error.statusCode).toBe(400);
            expect(error.message).toBe(ONE_READ_MESSAGE);
            expect(error.issue[0].code).toBe('too-costly');
        });

        test('each request (context) has its own claim', () => {
            claimExtendedMemberRead({});
            expect(() => claimExtendedMemberRead({})).not.toThrow();
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
                        configManager: { enableExtendedGroup, graphqlGroupMemberMaxCount: MAX, mongoTimeout: MONGO_TIMEOUT },
                        mongoGroupMemberRepository: { getMemberPageAsync, getMemberCursorAsync },
                        scopesValidator: { isAdminScope: () => isAdmin }
                    },
                    dataApi: { debugMode, metaList: [] }
                }
            };
        }

        const extendedGroup = (uuid = 'g-uuid') => ({ _uuid: uuid, _extended: true });

        test('embedded Group resolves the inline list, slices it and is not limited', async () => {
            const { context, getMemberPageAsync } = buildContext();
            const parent = { _uuid: 'g-uuid', member: [{ n: 1 }, { n: 2 }, { n: 3 }] };

            expect(await resolveGroupMemberAsync(parent, {}, context)).toEqual(parent.member);
            expect(await resolveGroupMemberAsync(parent, { _offset: 1, _count: 1 }, context)).toEqual([{ n: 2 }]);
            expect(await resolveGroupMemberAsync(parent, {}, context)).toEqual(parent.member);
            expect(getMemberPageAsync).not.toHaveBeenCalled();
        });

        test('extended Group reads one clamped, time-limited page, never the full cursor', async () => {
            const { context, getMemberPageAsync, getMemberCursorAsync } = buildContext();

            const result = await resolveGroupMemberAsync(extendedGroup(), { _offset: 5, _count: 5000000 }, context);

            expect(result).toEqual([{ entity: { reference: 'Patient/1' } }]);
            expect(getMemberPageAsync).toHaveBeenCalledTimes(1);
            expect(getMemberPageAsync).toHaveBeenCalledWith({
                base_version: '4_0_0',
                groupUuid: 'g-uuid',
                offset: 5,
                count: MAX,
                maxTimeMS: MONGO_TIMEOUT
            });
            expect(getMemberCursorAsync).not.toHaveBeenCalled();
        });

        test('extended Group with no paging args reads the maximum page size', async () => {
            const { context, getMemberPageAsync } = buildContext();

            await resolveGroupMemberAsync(extendedGroup(), {}, context);

            expect(getMemberPageAsync).toHaveBeenCalledWith(expect.objectContaining({ offset: 0, count: MAX }));
        });

        test.each([0, -5])('_count %p returns [] without a Mongo read and does not use up the request read', async (count) => {
            const { context, getMemberPageAsync } = buildContext();

            expect(await resolveGroupMemberAsync(extendedGroup(), { _count: count }, context)).toEqual([]);
            expect(getMemberPageAsync).not.toHaveBeenCalled();
            await resolveGroupMemberAsync(extendedGroup(), {}, context);
            expect(getMemberPageAsync).toHaveBeenCalledTimes(1);
        });

        test('a second extended read in the same request is rejected before reading', async () => {
            const { context, getMemberPageAsync } = buildContext();

            await resolveGroupMemberAsync(extendedGroup(), { _count: 10 }, context);
            await expect(resolveGroupMemberAsync(extendedGroup(), { _offset: 10, _count: 10 }, context))
                .rejects.toThrow(ONE_READ_MESSAGE);
            await expect(resolveGroupMemberAsync(extendedGroup('other-uuid'), {}, context))
                .rejects.toThrow(ONE_READ_MESSAGE);
            expect(getMemberPageAsync).toHaveBeenCalledTimes(1);
        });

        test('concurrent resolvers of one request: only the first reads', async () => {
            const { context, getMemberPageAsync } = buildContext();

            const results = await Promise.allSettled([
                resolveGroupMemberAsync(extendedGroup('a'), {}, context),
                resolveGroupMemberAsync(extendedGroup('b'), {}, context),
                resolveGroupMemberAsync(extendedGroup('c'), {}, context)
            ]);

            expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'rejected']);
            expect(getMemberPageAsync).toHaveBeenCalledTimes(1);
            expect(getMemberPageAsync).toHaveBeenCalledWith(expect.objectContaining({ groupUuid: 'a' }));
        });

        test('embedded Groups do not use up the request read', async () => {
            const { context, getMemberPageAsync } = buildContext();

            await resolveGroupMemberAsync({ _uuid: 'e', member: [{ n: 1 }] }, {}, context);
            await resolveGroupMemberAsync(extendedGroup(), {}, context);
            expect(getMemberPageAsync).toHaveBeenCalledTimes(1);
        });

        test('feature flag off: extended Group falls back to the document member (none)', async () => {
            const { context, getMemberPageAsync } = buildContext({ enableExtendedGroup: false });

            expect(await resolveGroupMemberAsync(extendedGroup(), {}, context)).toBeUndefined();
            expect(getMemberPageAsync).not.toHaveBeenCalled();
        });

        test('_debug from an admin caller adds the GroupMember query to the response meta', async () => {
            const { context } = buildContext({ debugMode: true });

            await resolveGroupMemberAsync(extendedGroup(), {}, context);

            expect(context.dataApi.metaList).toHaveLength(1);
            const tags = context.dataApi.metaList[0].tag;
            expect(tags.find((t) => t.system === 'https://www.icanbwell.com/queryCollection').code)
                .toBe('GroupMember_4_0_0');
            expect(tags.find((t) => t.system === 'https://www.icanbwell.com/query').display)
                .toContain('db.GroupMember_4_0_0.find');
        });

        test('_debug from a non-admin caller adds no query tags', async () => {
            const { context } = buildContext({ debugMode: true, isAdmin: false });

            await resolveGroupMemberAsync(extendedGroup(), {}, context);

            expect(context.dataApi.metaList).toEqual([]);
        });
    });
});
