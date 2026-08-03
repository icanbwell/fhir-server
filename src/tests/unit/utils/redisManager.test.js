'use strict';

const { describe, test, expect, beforeEach, afterEach, jest: jestObj } = require('@jest/globals');

// Mock dependencies
jestObj.mock('../../../operations/common/logging', () => ({
    logError: jestObj.fn()
}));

jestObj.mock('../../../operations/common/sentry', () => ({
    captureException: jestObj.fn()
}));

jestObj.mock('../../../utils/redisClient', () => ({
    RedisClient: jestObj.fn()
}));

const { RedisManager } = require('../../../utils/redisManager');
const { logError } = require('../../../operations/common/logging');
const { captureException } = require('../../../operations/common/sentry');

describe('RedisManager', () => {
    let redisManager;
    let mockRedisClient;
    let originalEnv;

    beforeEach(() => {
        jestObj.clearAllMocks();
        originalEnv = process.env.REDIS_KEY_DEFAULT_TTL_SECONDS;
        delete process.env.REDIS_KEY_DEFAULT_TTL_SECONDS;

        mockRedisClient = {
            connectAsync: jestObj.fn().mockResolvedValue(undefined),
            set: jestObj.fn().mockResolvedValue(undefined),
            get: jestObj.fn().mockResolvedValue(null),
            hasKey: jestObj.fn().mockResolvedValue(false),
            incr: jestObj.fn().mockResolvedValue(1),
            deleteKey: jestObj.fn().mockResolvedValue(undefined)
        };

        redisManager = new RedisManager({ redisClient: mockRedisClient });
    });

    afterEach(() => {
        if (originalEnv !== undefined) {
            process.env.REDIS_KEY_DEFAULT_TTL_SECONDS = originalEnv;
        } else {
            delete process.env.REDIS_KEY_DEFAULT_TTL_SECONDS;
        }
    });

    describe('constructor', () => {
        test('sets defaultTtlSeconds to 600 when env var not set', () => {
            const manager = new RedisManager({ redisClient: mockRedisClient });
            expect(manager.defaultTtlSeconds).toBe(600);
        });

        test('uses REDIS_KEY_DEFAULT_TTL_SECONDS env var when set', () => {
            process.env.REDIS_KEY_DEFAULT_TTL_SECONDS = '1200';
            const manager = new RedisManager({ redisClient: mockRedisClient });
            expect(manager.defaultTtlSeconds).toBe(1200);
        });

        test('falls back to 600 when env var is not a number', () => {
            process.env.REDIS_KEY_DEFAULT_TTL_SECONDS = 'invalid';
            const manager = new RedisManager({ redisClient: mockRedisClient });
            expect(manager.defaultTtlSeconds).toBe(600);
        });
    });

    describe('writeBundleAsync', () => {
        test('uses defaultTtlSeconds when no ttl provided', async () => {
            const bundle = { resourceType: 'Bundle', entry: [] };
            await redisManager.writeBundleAsync('cache:key', bundle);

            expect(mockRedisClient.set).toHaveBeenCalledWith(
                'cache:key',
                JSON.stringify(bundle),
                600
            );
        });

        test('uses defaultTtlSeconds when ttl is null', async () => {
            const bundle = { resourceType: 'Bundle' };
            await redisManager.writeBundleAsync('cache:key', bundle, null);

            expect(mockRedisClient.set).toHaveBeenCalledWith(
                'cache:key',
                JSON.stringify(bundle),
                600
            );
        });

        test('uses defaultTtlSeconds when ttl is 0 (falsy)', async () => {
            const bundle = { resourceType: 'Bundle' };
            await redisManager.writeBundleAsync('cache:key', bundle, 0);

            // 0 is falsy so it falls through to defaultTtlSeconds
            expect(mockRedisClient.set).toHaveBeenCalledWith(
                'cache:key',
                JSON.stringify(bundle),
                600
            );
        });

        test('custom ttl overrides default', async () => {
            const bundle = { resourceType: 'Bundle', entry: [{ resource: { id: '1' } }] };
            await redisManager.writeBundleAsync('cache:key', bundle, 300);

            expect(mockRedisClient.set).toHaveBeenCalledWith(
                'cache:key',
                JSON.stringify(bundle),
                300
            );
        });

        test('JSON stringifies the bundle before storing', async () => {
            const bundle = { resourceType: 'Bundle', total: 5, entry: [{ resource: { id: 'abc' } }] };
            await redisManager.writeBundleAsync('cache:key', bundle);

            const storedValue = mockRedisClient.set.mock.calls[0][1];
            expect(JSON.parse(storedValue)).toEqual(bundle);
        });

        test('connects to Redis before setting', async () => {
            await redisManager.writeBundleAsync('key', { data: true });

            expect(mockRedisClient.connectAsync).toHaveBeenCalled();
            // connectAsync should be called before set
            const connectOrder = mockRedisClient.connectAsync.mock.invocationCallOrder[0];
            const setOrder = mockRedisClient.set.mock.invocationCallOrder[0];
            expect(connectOrder).toBeLessThan(setOrder);
        });

        test('deletes key on error to prevent partial writes', async () => {
            const error = new Error('Redis write failed');
            mockRedisClient.set.mockRejectedValue(error);

            await redisManager.writeBundleAsync('cache:broken', { data: true });

            expect(mockRedisClient.deleteKey).toHaveBeenCalledWith('cache:broken');
        });

        test('logs error when write fails', async () => {
            const error = new Error('Redis write failed');
            mockRedisClient.set.mockRejectedValue(error);

            await redisManager.writeBundleAsync('cache:key', {});

            expect(logError).toHaveBeenCalledWith(
                'Error writing bundle to Redis',
                expect.objectContaining({ error, cacheKey: 'cache:key' })
            );
        });

        test('captures exception when write fails', async () => {
            const error = new Error('Connection timeout');
            mockRedisClient.set.mockRejectedValue(error);

            await redisManager.writeBundleAsync('cache:key', {});

            expect(captureException).toHaveBeenCalledWith(error);
        });

        test('does not throw when write fails (swallows error)', async () => {
            mockRedisClient.set.mockRejectedValue(new Error('fail'));

            await expect(redisManager.writeBundleAsync('key', {})).resolves.toBeUndefined();
        });
    });

    describe('hasCacheKeyAsync', () => {
        test('returns true when key exists', async () => {
            mockRedisClient.hasKey.mockResolvedValue(true);

            const result = await redisManager.hasCacheKeyAsync('existing:key');
            expect(result).toBe(true);
        });

        test('returns false when key does not exist', async () => {
            mockRedisClient.hasKey.mockResolvedValue(false);

            const result = await redisManager.hasCacheKeyAsync('missing:key');
            expect(result).toBe(false);
        });

        test('returns false on Redis error (fail-closed for reads)', async () => {
            mockRedisClient.hasKey.mockRejectedValue(new Error('Redis connection lost'));

            const result = await redisManager.hasCacheKeyAsync('key');
            expect(result).toBe(false);
        });

        test('never throws even on critical Redis failure', async () => {
            mockRedisClient.connectAsync.mockRejectedValue(new Error('Cannot connect'));

            const result = await redisManager.hasCacheKeyAsync('key');
            expect(result).toBe(false);
        });

        test('logs error when check fails', async () => {
            const error = new Error('Connection refused');
            mockRedisClient.hasKey.mockRejectedValue(error);

            await redisManager.hasCacheKeyAsync('key');
            expect(logError).toHaveBeenCalledWith(
                'Error checking Redis cache',
                expect.objectContaining({ error, cacheKey: 'key' })
            );
        });

        test('does NOT capture exception on error (unlike writeBundleAsync)', async () => {
            mockRedisClient.hasKey.mockRejectedValue(new Error('fail'));

            await redisManager.hasCacheKeyAsync('key');
            expect(captureException).not.toHaveBeenCalled();
        });
    });

    describe('getCacheAsync', () => {
        test('returns cached value when found', async () => {
            mockRedisClient.get.mockResolvedValue('cached-data');

            const result = await redisManager.getCacheAsync('cache:key');
            expect(result).toBe('cached-data');
        });

        test('returns null when key has no value', async () => {
            mockRedisClient.get.mockResolvedValue(null);

            const result = await redisManager.getCacheAsync('missing:key');
            expect(result).toBeNull();
        });

        test('THROWS on error (inconsistent with hasCacheKeyAsync)', async () => {
            const error = new Error('Redis get failed');
            mockRedisClient.get.mockRejectedValue(error);

            await expect(redisManager.getCacheAsync('key')).rejects.toThrow('Redis get failed');
        });

        test('logs error before throwing', async () => {
            const error = new Error('Timeout');
            mockRedisClient.get.mockRejectedValue(error);

            await expect(redisManager.getCacheAsync('key')).rejects.toThrow();
            expect(logError).toHaveBeenCalledWith(
                'Error getting Redis cache',
                expect.objectContaining({ error, cacheKey: 'key' })
            );
        });

        test('does NOT capture exception (only logs and throws)', async () => {
            mockRedisClient.get.mockRejectedValue(new Error('fail'));

            await expect(redisManager.getCacheAsync('key')).rejects.toThrow();
            expect(captureException).not.toHaveBeenCalled();
        });
    });

    describe('incrementGenerationAsync', () => {
        test('returns incremented value on success', async () => {
            mockRedisClient.incr.mockResolvedValue(42);

            const result = await redisManager.incrementGenerationAsync('gen:key');
            expect(result).toBe(42);
        });

        test('throws AND captures exception on error', async () => {
            const error = new Error('Redis incr failed');
            mockRedisClient.incr.mockRejectedValue(error);

            await expect(redisManager.incrementGenerationAsync('gen:key'))
                .rejects.toThrow('Redis incr failed');
            expect(captureException).toHaveBeenCalledWith(error);
        });

        test('logs error before throwing', async () => {
            const error = new Error('Increment failure');
            mockRedisClient.incr.mockRejectedValue(error);

            await expect(redisManager.incrementGenerationAsync('gen:key')).rejects.toThrow();
            expect(logError).toHaveBeenCalledWith(
                'Error incrementing generation in Redis',
                expect.objectContaining({ error, cacheKey: 'gen:key' })
            );
        });

        test('connects before incrementing', async () => {
            mockRedisClient.incr.mockResolvedValue(1);

            await redisManager.incrementGenerationAsync('gen:key');
            expect(mockRedisClient.connectAsync).toHaveBeenCalled();
        });
    });

    describe('deleteKeyAsync', () => {
        test('deletes key successfully', async () => {
            await redisManager.deleteKeyAsync('key:to:delete');

            expect(mockRedisClient.connectAsync).toHaveBeenCalled();
            expect(mockRedisClient.deleteKey).toHaveBeenCalledWith('key:to:delete');
        });

        test('swallows error silently (does not throw)', async () => {
            mockRedisClient.deleteKey.mockRejectedValue(new Error('Delete failed'));

            await expect(redisManager.deleteKeyAsync('key')).resolves.toBeUndefined();
        });

        test('logs error on failure', async () => {
            const error = new Error('Delete failed');
            mockRedisClient.deleteKey.mockRejectedValue(error);

            await redisManager.deleteKeyAsync('key');
            expect(logError).toHaveBeenCalledWith(
                'Error deleting Redis cache',
                expect.objectContaining({ error, cacheKey: 'key' })
            );
        });

        test('captures exception on failure', async () => {
            const error = new Error('Delete failed');
            mockRedisClient.deleteKey.mockRejectedValue(error);

            await redisManager.deleteKeyAsync('key');
            expect(captureException).toHaveBeenCalledWith(error);
        });
    });

    describe('readBundleFromCacheAsync', () => {
        test('returns parsed JSON bundle when found', async () => {
            const bundle = { resourceType: 'Bundle', total: 1, entry: [{ resource: { id: '123' } }] };
            mockRedisClient.get.mockResolvedValue(JSON.stringify(bundle));

            const result = await redisManager.readBundleFromCacheAsync('bundle:key');
            expect(result).toEqual(bundle);
        });

        test('returns null when key does not exist (get returns null)', async () => {
            mockRedisClient.get.mockResolvedValue(null);

            const result = await redisManager.readBundleFromCacheAsync('missing:key');
            expect(result).toBeNull();
        });

        test('returns null on error (swallows exception)', async () => {
            mockRedisClient.get.mockRejectedValue(new Error('Redis read failed'));

            const result = await redisManager.readBundleFromCacheAsync('key');
            expect(result).toBeUndefined(); // falls through catch without explicit return
        });

        test('does not crash on JSON.parse errors (caught by try/catch)', async () => {
            mockRedisClient.get.mockResolvedValue('not-valid-json{{{');

            const result = await redisManager.readBundleFromCacheAsync('key');
            // JSON.parse error is caught, logs and returns undefined
            expect(result).toBeUndefined();
        });

        test('logs error on failure', async () => {
            const error = new Error('Read failed');
            mockRedisClient.get.mockRejectedValue(error);

            await redisManager.readBundleFromCacheAsync('key');
            expect(logError).toHaveBeenCalledWith(
                'Error reading bundle from Redis',
                expect.objectContaining({ error, cacheKey: 'key' })
            );
        });

        test('captures exception on failure', async () => {
            const error = new Error('Read failed');
            mockRedisClient.get.mockRejectedValue(error);

            await redisManager.readBundleFromCacheAsync('key');
            expect(captureException).toHaveBeenCalledWith(error);
        });

        test('captures exception on JSON parse error', async () => {
            mockRedisClient.get.mockResolvedValue('invalid json');

            await redisManager.readBundleFromCacheAsync('key');
            expect(captureException).toHaveBeenCalled();
        });

        test('returns empty object when stored value is "{}"', async () => {
            mockRedisClient.get.mockResolvedValue('{}');

            const result = await redisManager.readBundleFromCacheAsync('key');
            expect(result).toEqual({});
        });

        test('returns null when get returns empty string', async () => {
            mockRedisClient.get.mockResolvedValue('');

            // empty string is falsy so the `if (response)` check fails
            const result = await redisManager.readBundleFromCacheAsync('key');
            expect(result).toBeNull();
        });
    });

    describe('error handling consistency', () => {
        test('writeBundleAsync swallows errors', async () => {
            mockRedisClient.set.mockRejectedValue(new Error('fail'));
            await expect(redisManager.writeBundleAsync('k', {})).resolves.not.toThrow();
        });

        test('hasCacheKeyAsync swallows errors (returns false)', async () => {
            mockRedisClient.hasKey.mockRejectedValue(new Error('fail'));
            await expect(redisManager.hasCacheKeyAsync('k')).resolves.toBe(false);
        });

        test('getCacheAsync throws errors', async () => {
            mockRedisClient.get.mockRejectedValue(new Error('fail'));
            await expect(redisManager.getCacheAsync('k')).rejects.toThrow('fail');
        });

        test('incrementGenerationAsync throws errors', async () => {
            mockRedisClient.incr.mockRejectedValue(new Error('fail'));
            await expect(redisManager.incrementGenerationAsync('k')).rejects.toThrow('fail');
        });

        test('deleteKeyAsync swallows errors', async () => {
            mockRedisClient.deleteKey.mockRejectedValue(new Error('fail'));
            await expect(redisManager.deleteKeyAsync('k')).resolves.not.toThrow();
        });

        test('readBundleFromCacheAsync swallows errors', async () => {
            mockRedisClient.get.mockRejectedValue(new Error('fail'));
            await expect(redisManager.readBundleFromCacheAsync('k')).resolves.not.toThrow();
        });
    });
});
