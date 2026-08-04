'use strict';

const { describe, test, beforeEach, expect, jest: jestGlobal } = require('@jest/globals');
const { MongoWithClickHouseStorageProvider } = require('../../../../dataLayer/providers/mongoWithClickHouseStorageProvider');

function createProvider(overrides = {}) {
    const resourceLocator = overrides.resourceLocator || {};
    const clickHouseClientManager = {
        queryAsync: jestGlobal.fn().mockResolvedValue([{ count: '5' }])
    };
    const mongoStorageProvider = {
        findAsync: jestGlobal.fn().mockResolvedValue({ toArray: () => [] }),
        findOneAsync: jestGlobal.fn().mockResolvedValue(null),
        fastFindOneAsync: jestGlobal.fn().mockResolvedValue(null),
        upsertAsync: jestGlobal.fn().mockResolvedValue({ acknowledged: true }),
        countAsync: jestGlobal.fn().mockResolvedValue(10)
    };
    const configManager = {};

    return new MongoWithClickHouseStorageProvider({
        resourceLocator,
        clickHouseClientManager: overrides.clickHouseClientManager || clickHouseClientManager,
        mongoStorageProvider: overrides.mongoStorageProvider || mongoStorageProvider,
        configManager
    });
}

describe('MongoWithClickHouseStorageProvider - unit tests', () => {
    let provider;
    let clickHouseClientManager;
    let mongoStorageProvider;

    beforeEach(() => {
        clickHouseClientManager = { queryAsync: jestGlobal.fn().mockResolvedValue([{ count: '5' }]) };
        mongoStorageProvider = {
            findAsync: jestGlobal.fn().mockResolvedValue({ toArray: () => [] }),
            findOneAsync: jestGlobal.fn().mockResolvedValue({ id: 'g1', resourceType: 'Group' }),
            fastFindOneAsync: jestGlobal.fn().mockResolvedValue({ id: 'g1' }),
            upsertAsync: jestGlobal.fn().mockResolvedValue({ acknowledged: true }),
            countAsync: jestGlobal.fn().mockResolvedValue(10)
        };
        provider = createProvider({ clickHouseClientManager, mongoStorageProvider });
    });

    describe('getCurrentMembersWithCountAsync', () => {
        test('returns members and count from ClickHouse', async () => {
            clickHouseClientManager.queryAsync
                .mockResolvedValueOnce([{ count: '42' }])
                .mockResolvedValueOnce([{ entity_reference: 'Patient/p1' }, { entity_reference: 'Patient/p2' }]);

            const result = await provider.getCurrentMembersWithCountAsync('group-1', { limit: 10 });
            expect(result.totalCount).toBe(42);
            expect(result.members.length).toBe(2);
            expect(clickHouseClientManager.queryAsync).toHaveBeenCalledTimes(2);
        });

        test('returns 0 count when no results', async () => {
            clickHouseClientManager.queryAsync
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([]);

            const result = await provider.getCurrentMembersWithCountAsync('empty-group');
            expect(result.totalCount).toBe(0);
            expect(result.members).toEqual([]);
        });

        test('throws on ClickHouse error', async () => {
            clickHouseClientManager.queryAsync.mockRejectedValue(new Error('CH connection failed'));
            await expect(provider.getCurrentMembersWithCountAsync('group-err')).rejects.toThrow(/ClickHouse/);
        });

        test('passes afterReference for seek pagination', async () => {
            clickHouseClientManager.queryAsync
                .mockResolvedValueOnce([{ count: '100' }])
                .mockResolvedValueOnce([{ entity_reference: 'Patient/p3' }]);

            await provider.getCurrentMembersWithCountAsync('group-seek', { limit: 50, afterReference: 'Patient/p2' });
            expect(clickHouseClientManager.queryAsync).toHaveBeenCalledTimes(2);
        });

        test('boundary: limit=0', async () => {
            clickHouseClientManager.queryAsync
                .mockResolvedValueOnce([{ count: '0' }])
                .mockResolvedValueOnce([]);
            const result = await provider.getCurrentMembersWithCountAsync('g', { limit: 0 });
            expect(result.totalCount).toBe(0);
        });

        test('boundary: limit=1', async () => {
            clickHouseClientManager.queryAsync
                .mockResolvedValueOnce([{ count: '100' }])
                .mockResolvedValueOnce([{ entity_reference: 'Patient/p1' }]);
            const result = await provider.getCurrentMembersWithCountAsync('g', { limit: 1 });
            expect(result.members.length).toBe(1);
        });
    });

    describe('getActiveMemberCountAsync', () => {
        test('returns active member count', async () => {
            clickHouseClientManager.queryAsync.mockResolvedValue([{ count: '25' }]);
            const count = await provider.getActiveMemberCountAsync('group-count');
            expect(count).toBe(25);
        });

        test('returns 0 when no results', async () => {
            clickHouseClientManager.queryAsync.mockResolvedValue([{}]);
            const count = await provider.getActiveMemberCountAsync('empty-group');
            expect(count).toBe(0);
        });

        test('throws on error', async () => {
            clickHouseClientManager.queryAsync.mockRejectedValue(new Error('timeout'));
            await expect(provider.getActiveMemberCountAsync('g')).rejects.toThrow(/ClickHouse/);
        });
    });

    describe('findGroupsByMemberAsync', () => {
        test('returns group_id results', async () => {
            clickHouseClientManager.queryAsync.mockResolvedValue([{ group_id: 'g1' }, { group_id: 'g2' }]);
            const result = await provider.findGroupsByMemberAsync('Patient/p1');
            expect(result.length).toBe(2);
            expect(result[0].group_id).toBe('g1');
        });

        test('returns empty array when no groups found', async () => {
            clickHouseClientManager.queryAsync.mockResolvedValue([]);
            const result = await provider.findGroupsByMemberAsync('Patient/nobody');
            expect(result).toEqual([]);
        });

        test('returns empty array on null result', async () => {
            clickHouseClientManager.queryAsync.mockResolvedValue(null);
            const result = await provider.findGroupsByMemberAsync('Patient/x');
            expect(result).toEqual([]);
        });

        test('throws on error', async () => {
            clickHouseClientManager.queryAsync.mockRejectedValue(new Error('network'));
            await expect(provider.findGroupsByMemberAsync('Patient/x')).rejects.toThrow(/ClickHouse/);
        });
    });

    describe('findAsync', () => {
        test('routes non-member query to MongoDB', async () => {
            const query = { _uuid: 'some-uuid' };
            await provider.findAsync({ query, options: {} });
            expect(mongoStorageProvider.findAsync).toHaveBeenCalledWith(expect.objectContaining({ query }));
        });

        test('routes member query to MongoDB when useExternal is false', async () => {
            const query = { 'member.entity._reference': 'Patient/p1' };
            await provider.findAsync({ query, options: {}, extraInfo: {} });
            expect(mongoStorageProvider.findAsync).toHaveBeenCalled();
        });
    });

    describe('findOneAsync', () => {
        test('delegates to mongoStorageProvider', async () => {
            const result = await provider.findOneAsync({ query: { _uuid: 'u1' } });
            expect(mongoStorageProvider.findOneAsync).toHaveBeenCalled();
            expect(result.id).toBe('g1');
        });
    });

    describe('fastFindOneAsync', () => {
        test('delegates to mongoStorageProvider', async () => {
            await provider.fastFindOneAsync({ query: { _uuid: 'u1' } });
            expect(mongoStorageProvider.fastFindOneAsync).toHaveBeenCalled();
        });
    });

    describe('upsertAsync', () => {
        test('writes each resource to MongoDB', async () => {
            const resources = [{ id: 'g1' }, { id: 'g2' }];
            const result = await provider.upsertAsync({ resources });
            expect(result.acknowledged).toBe(true);
            expect(result.insertedCount).toBe(2);
            expect(mongoStorageProvider.upsertAsync).toHaveBeenCalledTimes(2);
        });

        test('0 resources returns empty result', async () => {
            const result = await provider.upsertAsync({ resources: [] });
            expect(result.insertedCount).toBe(0);
        });

        test('throws on mongo error', async () => {
            mongoStorageProvider.upsertAsync.mockRejectedValue(new Error('write failed'));
            await expect(provider.upsertAsync({ resources: [{ id: 'x' }] })).rejects.toThrow(/dual-write/);
        });
    });

    describe('countAsync', () => {
        test('routes non-member query to MongoDB', async () => {
            const result = await provider.countAsync({ query: { type: 'person' } });
            expect(result).toBe(10);
            expect(mongoStorageProvider.countAsync).toHaveBeenCalled();
        });
    });

    describe('getStorageType', () => {
        test('returns MONGO_WITH_CLICKHOUSE', () => {
            expect(provider.getStorageType()).toBe('mongo-with-clickhouse');
        });
    });

    describe('_isMemberQuery', () => {
        test('detects member field at top level', () => {
            expect(provider._isMemberQuery({ member: { $exists: true } })).toBe(true);
        });

        test('detects member.entity nested field', () => {
            expect(provider._isMemberQuery({ 'member.entity._reference': 'Patient/p1' })).toBe(true);
        });

        test('detects member in $and', () => {
            expect(provider._isMemberQuery({ $and: [{ member: 'x' }] })).toBe(true);
        });

        test('detects member in $or', () => {
            expect(provider._isMemberQuery({ $or: [{ 'member.entity': 'x' }] })).toBe(true);
        });

        test('returns false for non-member queries', () => {
            expect(provider._isMemberQuery({ type: 'person', name: 'test' })).toBe(false);
        });

        test('returns false for null/undefined', () => {
            expect(provider._isMemberQuery(null)).toBe(false);
            expect(provider._isMemberQuery(undefined)).toBe(false);
        });
    });
});
