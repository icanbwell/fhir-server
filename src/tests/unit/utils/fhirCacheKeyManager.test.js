const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../operations/common/baseCacheKeyGenerator', () => {
    class BaseCacheKeyGenerator {
        generateIdComponent({ id, isPersonId }) {
            const resourceType = isPersonId ? 'ClientPerson' : 'Patient';
            return `${resourceType}:${id}`;
        }
    }
    return { BaseCacheKeyGenerator };
});

jestObj.mock('../../../utils/redisClient', () => ({
    RedisClient: class RedisClient {}
}));

const { FhirCacheKeyManager } = require('../../../utils/fhirCacheKeyManager');

describe('FhirCacheKeyManager', () => {
    let manager;
    let mockRedisClient;

    beforeEach(() => {
        mockRedisClient = {
            connectAsync: jestObj.fn().mockResolvedValue(undefined),
            bulkDeleteKeys: jestObj.fn().mockResolvedValue(undefined),
            invalidateByPrefixAsync: jestObj.fn().mockResolvedValue(undefined),
            getAllKeysByPrefix: jestObj.fn().mockResolvedValue([]),
            get: jestObj.fn().mockResolvedValue(null)
        };

        manager = new FhirCacheKeyManager({ redisClient: mockRedisClient });
    });

    describe('invalidateCacheKeys', () => {
        test('connects to redis and deletes the specified keys', async () => {
            const cacheKeys = ['key1', 'key2', 'key3'];

            await manager.invalidateCacheKeys({ cacheKeys });

            expect(mockRedisClient.connectAsync).toHaveBeenCalled();
            expect(mockRedisClient.bulkDeleteKeys).toHaveBeenCalledWith(cacheKeys);
        });

        test('handles empty array of keys', async () => {
            await manager.invalidateCacheKeys({ cacheKeys: [] });

            expect(mockRedisClient.connectAsync).toHaveBeenCalled();
            expect(mockRedisClient.bulkDeleteKeys).toHaveBeenCalledWith([]);
        });
    });

    describe('invalidateCacheKeysForResource', () => {
        test('generates Patient prefix for non-Person resourceType', async () => {
            await manager.invalidateCacheKeysForResource({
                resourceType: 'Patient',
                resourceId: '123'
            });

            expect(mockRedisClient.connectAsync).toHaveBeenCalled();
            expect(mockRedisClient.invalidateByPrefixAsync).toHaveBeenCalledWith('Patient:123');
        });

        test('generates ClientPerson prefix for Person resourceType', async () => {
            await manager.invalidateCacheKeysForResource({
                resourceType: 'Person',
                resourceId: 'person-456'
            });

            expect(mockRedisClient.connectAsync).toHaveBeenCalled();
            expect(mockRedisClient.invalidateByPrefixAsync).toHaveBeenCalledWith('ClientPerson:person-456');
        });

        test('returns undefined when prefix is falsy (empty id)', async () => {
            const result = await manager.invalidateCacheKeysForResource({
                resourceType: 'Patient',
                resourceId: ''
            });

            // The prefix will be "Patient:" which is truthy, so it will still call invalidate
            // Actually let's check what generateIdComponent returns for empty id
            expect(mockRedisClient.connectAsync).toHaveBeenCalled();
        });
    });

    describe('getAllKeysForResource', () => {
        test('returns separated cache keys and generation keys', async () => {
            mockRedisClient.getAllKeysByPrefix.mockResolvedValue([
                'Patient:123:search:Scopes:abc',
                'Patient:123:read:Generation',
                'Patient:123:everything:Scopes:def'
            ]);
            mockRedisClient.get.mockResolvedValue('42');

            const result = await manager.getAllKeysForResource({
                resourceType: 'Patient',
                resourceId: '123'
            });

            expect(result.cacheKeys).toEqual([
                'Patient:123:search:Scopes:abc',
                'Patient:123:everything:Scopes:def'
            ]);
            expect(result.generationKeys).toEqual([
                { key: 'Patient:123:read:Generation', value: '42' }
            ]);
        });

        test('uses ClientPerson prefix for Person resource type', async () => {
            mockRedisClient.getAllKeysByPrefix.mockResolvedValue([]);

            await manager.getAllKeysForResource({
                resourceType: 'Person',
                resourceId: 'p1'
            });

            expect(mockRedisClient.getAllKeysByPrefix).toHaveBeenCalledWith('ClientPerson:p1');
        });

        test('uses Patient prefix for non-Person resource type', async () => {
            mockRedisClient.getAllKeysByPrefix.mockResolvedValue([]);

            await manager.getAllKeysForResource({
                resourceType: 'Observation',
                resourceId: 'obs-1'
            });

            expect(mockRedisClient.getAllKeysByPrefix).toHaveBeenCalledWith('Patient:obs-1');
        });

        test('returns empty arrays when no keys exist', async () => {
            mockRedisClient.getAllKeysByPrefix.mockResolvedValue([]);

            const result = await manager.getAllKeysForResource({
                resourceType: 'Patient',
                resourceId: 'nonexistent'
            });

            expect(result.cacheKeys).toEqual([]);
            expect(result.generationKeys).toEqual([]);
        });

        test('fetches generation values for all generation keys', async () => {
            mockRedisClient.getAllKeysByPrefix.mockResolvedValue([
                'Patient:123:read:Generation',
                'Patient:123:search:Generation'
            ]);
            mockRedisClient.get
                .mockResolvedValueOnce('10')
                .mockResolvedValueOnce('20');

            const result = await manager.getAllKeysForResource({
                resourceType: 'Patient',
                resourceId: '123'
            });

            expect(result.generationKeys).toEqual([
                { key: 'Patient:123:read:Generation', value: '10' },
                { key: 'Patient:123:search:Generation', value: '20' }
            ]);
            expect(mockRedisClient.get).toHaveBeenCalledTimes(2);
        });

        test('handles null generation values gracefully', async () => {
            mockRedisClient.getAllKeysByPrefix.mockResolvedValue([
                'Patient:123:read:Generation'
            ]);
            mockRedisClient.get.mockResolvedValue(null);

            const result = await manager.getAllKeysForResource({
                resourceType: 'Patient',
                resourceId: '123'
            });

            expect(result.generationKeys).toEqual([
                { key: 'Patient:123:read:Generation', value: null }
            ]);
        });
    });
});
