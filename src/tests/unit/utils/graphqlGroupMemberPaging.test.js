const { describe, test, expect, jest } = require('@jest/globals');
const {
    getMemberPageWindow,
    sliceList,
    resolveGroupMemberAsync,
    reserveMemberRows
} = require('../../../utils/graphqlGroupMemberPaging');
const { RequestSpecificCache } = require('../../../utils/requestSpecificCache');

// stands in for configManager.graphqlGroupMemberMaxCount (default 50000)
const MAX = 1000;

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

    describe('reserveMemberRows', () => {
        function budgetContext(requestId = 'req-1', requestSpecificCache = new RequestSpecificCache()) {
            return { fhirRequestInfo: { requestId }, container: { requestSpecificCache } };
        }

        test('allows page sizes adding up to the request total', () => {
            const context = budgetContext();
            expect(() => reserveMemberRows(context, MAX - 1, MAX)).not.toThrow();
            expect(() => reserveMemberRows(context, 1, MAX)).not.toThrow();
        });

        test('rejects the reservation that takes the request over the total with too-costly', () => {
            const context = budgetContext();
            reserveMemberRows(context, MAX, MAX);

            let error;
            try {
                reserveMemberRows(context, 1, MAX);
            } catch (e) {
                error = e;
            }
            expect(error).toBeDefined();
            expect(error.statusCode).toBe(400);
            expect(error.message).toBe(
                `Group members count exceeds maximum (${MAX + 1} > ${MAX})`
            );
            expect(error.issue[0].code).toBe('too-costly');
        });

        test('a rejected reservation does not use up the budget', () => {
            const context = budgetContext();
            reserveMemberRows(context, MAX - 400, MAX);
            expect(() => reserveMemberRows(context, 600, MAX)).toThrow();
            expect(() => reserveMemberRows(context, 400, MAX)).not.toThrow();
        });

        test('each request has its own budget', () => {
            const cache = new RequestSpecificCache();
            reserveMemberRows(budgetContext('req-1', cache), MAX, MAX);
            expect(() => reserveMemberRows(budgetContext('req-2', cache), MAX, MAX)).not.toThrow();
        });

        test('fails closed without a request id', () => {
            expect(() => reserveMemberRows(budgetContext(null), 1, MAX)).toThrow();
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
                    fhirRequestInfo: { requestId: 'req-1', scope: isAdmin ? 'user/*.read admin/*.*' : 'user/*.read' },
                    container: {
                        requestSpecificCache: new RequestSpecificCache(),
                        configManager: { enableExtendedGroup, graphqlGroupMemberMaxCount: MAX },
                        mongoGroupMemberRepository: { getMemberPageAsync, getMemberCursorAsync },
                        scopesValidator: { isAdminScope: () => isAdmin }
                    },
                    dataApi: { debugMode, metaList: [] }
                }
            };
        }

        test('embedded Group resolves the inline list and slices it', async () => {
            const { context, getMemberPageAsync } = buildContext();
            const parent = { _uuid: 'g-uuid', member: [{ n: 1 }, { n: 2 }, { n: 3 }] };

            expect(await resolveGroupMemberAsync(parent, {}, context)).toEqual(parent.member);
            expect(await resolveGroupMemberAsync(parent, { _offset: 1, _count: 1 }, context)).toEqual([{ n: 2 }]);
            expect(getMemberPageAsync).not.toHaveBeenCalled();
        });

        test('extended Group reads one clamped page, never the full cursor', async () => {
            const { context, getMemberPageAsync, getMemberCursorAsync } = buildContext();

            const result = await resolveGroupMemberAsync(
                { _uuid: 'g-uuid', _extended: true }, { _offset: 5, _count: 5000000 }, context
            );

            expect(result).toEqual([{ entity: { reference: 'Patient/1' } }]);
            expect(getMemberPageAsync).toHaveBeenCalledTimes(1);
            expect(getMemberPageAsync).toHaveBeenCalledWith({
                base_version: '4_0_0',
                groupUuid: 'g-uuid',
                offset: 5,
                count: MAX
            });
            expect(getMemberCursorAsync).not.toHaveBeenCalled();
        });

        test('extended Group with no paging args reads the maximum page size', async () => {
            const { context, getMemberPageAsync } = buildContext();

            await resolveGroupMemberAsync({ _uuid: 'g-uuid', _extended: true }, {}, context);

            expect(getMemberPageAsync).toHaveBeenCalledWith(
                expect.objectContaining({ offset: 0, count: MAX })
            );
        });

        test.each([0, -5])('_count %p returns [] without a Mongo read (limit 0 is unlimited there)', async (count) => {
            const { context, getMemberPageAsync } = buildContext();

            expect(await resolveGroupMemberAsync({ _uuid: 'g-uuid', _extended: true }, { _count: count }, context))
                .toEqual([]);
            expect(getMemberPageAsync).not.toHaveBeenCalled();
        });

        test('pages past the request total are rejected before reading', async () => {
            const { context, getMemberPageAsync } = buildContext();
            const parent = { _uuid: 'g-uuid', _extended: true };

            await resolveGroupMemberAsync(parent, { _count: MAX / 2 }, context);
            await resolveGroupMemberAsync(parent, { _offset: MAX / 2, _count: MAX / 2 }, context);
            await expect(resolveGroupMemberAsync(parent, { _offset: MAX, _count: 1 }, context))
                .rejects.toThrow(`Group members count exceeds maximum (${MAX + 1} > ${MAX})`);
            expect(getMemberPageAsync).toHaveBeenCalledTimes(2);
        });

        test('_count 0 reserves nothing', async () => {
            const { context } = buildContext();
            const parent = { _uuid: 'g-uuid', _extended: true };

            await resolveGroupMemberAsync(parent, { _count: 0 }, context);
            expect(() => reserveMemberRows(context, MAX, MAX)).not.toThrow();
        });

        test('feature flag off: extended Group falls back to the document member (none)', async () => {
            const { context, getMemberPageAsync } = buildContext({ enableExtendedGroup: false });

            expect(await resolveGroupMemberAsync({ _uuid: 'g-uuid', _extended: true }, {}, context))
                .toBeUndefined();
            expect(getMemberPageAsync).not.toHaveBeenCalled();
        });

        test('_debug from an admin caller adds the GroupMember query to the response meta', async () => {
            const { context } = buildContext({ debugMode: true });

            await resolveGroupMemberAsync({ _uuid: 'g-uuid', _extended: true }, {}, context);

            expect(context.dataApi.metaList).toHaveLength(1);
            const tags = context.dataApi.metaList[0].tag;
            expect(tags.find((t) => t.system === 'https://www.icanbwell.com/queryCollection').code)
                .toBe('GroupMember_4_0_0');
            expect(tags.find((t) => t.system === 'https://www.icanbwell.com/query').display)
                .toContain('db.GroupMember_4_0_0.find');
        });

        test('_debug from a non-admin caller adds no query tags', async () => {
            const { context } = buildContext({ debugMode: true, isAdmin: false });

            await resolveGroupMemberAsync({ _uuid: 'g-uuid', _extended: true }, {}, context);

            expect(context.dataApi.metaList).toEqual([]);
        });
    });
});
