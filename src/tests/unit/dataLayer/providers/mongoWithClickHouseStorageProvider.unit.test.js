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
