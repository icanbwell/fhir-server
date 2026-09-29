'use strict';

const { describe, test, beforeEach, expect, jest: jestObj } = require('@jest/globals');

// Mock logging and sentry
jestObj.mock('../../../operations/common/logging', () => ({
    logError: jestObj.fn()
}));

jestObj.mock('../../../operations/common/sentry', () => ({
    captureException: jestObj.fn()
}));

const { RedisStreamManager } = require('../../../utils/redisStreamManager');
const { logError } = require('../../../operations/common/logging');
const { captureException } = require('../../../operations/common/sentry');

describe('RedisStreamManager', () => {
    let manager;
    let mockRedisClient;

    beforeEach(() => {
        jestObj.clearAllMocks();
        // Reset env vars
        delete process.env.REDIS_KEY_DEFAULT_TTL_SECONDS;
        delete process.env.REDIS_STREAM_READ_COUNT;

        mockRedisClient = {
            connectAsync: jestObj.fn().mockResolvedValue(undefined),
            addStreamEntry: jestObj.fn().mockResolvedValue(undefined),
            hasKey: jestObj.fn().mockResolvedValue(false),
            getStreamInfo: jestObj.fn().mockResolvedValue({ 'last-entry': { id: '0-0' } }),
            readFromStream: jestObj.fn().mockResolvedValue(null),
            deleteKey: jestObj.fn().mockResolvedValue(undefined)
        };

        manager = new RedisStreamManager({ redisClient: mockRedisClient });
    });

    describe('constructor', () => {
        test('assigns redisClient', () => {
            expect(manager.redisClient).toBe(mockRedisClient);
        });

        test('defaults TTL to 600 seconds when env not set', () => {
            expect(manager.defaultTtlSeconds).toBe(600);
        });

        test('uses REDIS_KEY_DEFAULT_TTL_SECONDS from env', () => {
            process.env.REDIS_KEY_DEFAULT_TTL_SECONDS = '300';
            const mgr = new RedisStreamManager({ redisClient: mockRedisClient });
            expect(mgr.defaultTtlSeconds).toBe(300);
        });
    });

    describe('writeBundleEntryToStream', () => {
        test('connects to Redis before writing', async () => {
            await manager.writeBundleEntryToStream('key-1', { id: 'entry-1' });
            expect(mockRedisClient.connectAsync).toHaveBeenCalled();
        });

        test('calls addStreamEntry with stringified bundle entry and default TTL', async () => {
            const bundleEntry = { id: 'entry-1', resourceType: 'Patient' };
            await manager.writeBundleEntryToStream('key-1', bundleEntry);
            expect(mockRedisClient.addStreamEntry).toHaveBeenCalledWith(
                'key-1',
                JSON.stringify(bundleEntry),
                600
            );
        });

        test('uses custom TTL when provided', async () => {
            const bundleEntry = { id: 'entry-1' };
            await manager.writeBundleEntryToStream('key-1', bundleEntry, 120);
            expect(mockRedisClient.addStreamEntry).toHaveBeenCalledWith(
                'key-1',
                JSON.stringify(bundleEntry),
                120
            );
        });

        test('uses default TTL when null is passed', async () => {
            const bundleEntry = { id: 'entry-1' };
            await manager.writeBundleEntryToStream('key-1', bundleEntry, null);
            expect(mockRedisClient.addStreamEntry).toHaveBeenCalledWith(
                'key-1',
                JSON.stringify(bundleEntry),
                600
            );
        });

        test('logs error and captures exception on failure', async () => {
            const error = new Error('Redis connection failed');
            mockRedisClient.connectAsync.mockRejectedValue(error);

            await manager.writeBundleEntryToStream('key-1', { id: '1' });

            expect(logError).toHaveBeenCalledWith(
                'Error writing to Redis stream',
                expect.objectContaining({ error, cacheKey: 'key-1' })
            );
            expect(captureException).toHaveBeenCalledWith(error);
        });

        test('does not throw on error (swallows it)', async () => {
            mockRedisClient.connectAsync.mockRejectedValue(new Error('fail'));
            await expect(
                manager.writeBundleEntryToStream('key-1', { id: '1' })
            ).resolves.toBeUndefined();
        });
    });

    describe('hasCachedStream', () => {
        test('connects to Redis before checking', async () => {
            await manager.hasCachedStream('key-1');
            expect(mockRedisClient.connectAsync).toHaveBeenCalled();
        });

        test('returns true when key exists', async () => {
            mockRedisClient.hasKey.mockResolvedValue(true);
            const result = await manager.hasCachedStream('key-1');
            expect(result).toBe(true);
        });

        test('returns false when key does not exist', async () => {
            mockRedisClient.hasKey.mockResolvedValue(false);
            const result = await manager.hasCachedStream('key-1');
            expect(result).toBe(false);
        });

        test('returns false on error', async () => {
            mockRedisClient.connectAsync.mockRejectedValue(new Error('fail'));
            const result = await manager.hasCachedStream('key-1');
            expect(result).toBe(false);
        });

        test('logs error on failure', async () => {
            const error = new Error('fail');
            mockRedisClient.hasKey.mockRejectedValue(error);
            await manager.hasCachedStream('key-1');
            expect(logError).toHaveBeenCalledWith(
                'Error checking Redis stream cache',
                expect.objectContaining({ error, cacheKey: 'key-1' })
            );
        });
    });

    describe('readBundleEntriesFromStream', () => {
        test('connects to Redis before reading', async () => {
            mockRedisClient.readFromStream.mockResolvedValue(null);
            await manager.readBundleEntriesFromStream('key-1', '0-0');
            expect(mockRedisClient.connectAsync).toHaveBeenCalled();
        });

        test('gets stream info to find last entry id', async () => {
            mockRedisClient.readFromStream.mockResolvedValue(null);
            await manager.readBundleEntriesFromStream('key-1', '0-0');
            expect(mockRedisClient.getStreamInfo).toHaveBeenCalledWith('key-1');
        });

        test('returns empty entries with hasMore=false when no results', async () => {
            mockRedisClient.readFromStream.mockResolvedValue(null);
            const result = await manager.readBundleEntriesFromStream('key-1', '0-0');
            expect(result).toEqual({ entries: [], hasMore: false, lastId: '0-0' });
        });

        test('returns empty entries with hasMore=false when results is empty array', async () => {
            mockRedisClient.readFromStream.mockResolvedValue([]);
            const result = await manager.readBundleEntriesFromStream('key-1', '0-0');
            expect(result).toEqual({ entries: [], hasMore: false, lastId: '0-0' });
        });

        test('parses messages and returns entries with hasMore=false when at last entry', async () => {
            const messages = [
                { id: '1-0', message: { data: JSON.stringify({ id: 'a' }) } },
                { id: '2-0', message: { data: JSON.stringify({ id: 'b' }) } }
            ];
            mockRedisClient.getStreamInfo.mockResolvedValue({ 'last-entry': { id: '2-0' } });
            mockRedisClient.readFromStream.mockResolvedValue([{ messages }]);

            const result = await manager.readBundleEntriesFromStream('key-1', '0-0');
            expect(result.entries).toEqual([{ id: 'a' }, { id: 'b' }]);
            expect(result.hasMore).toBe(false);
            expect(result.lastId).toBe('2-0');
        });

        test('sets hasMore=true when lastId does not match last entry id', async () => {
            const messages = [
                { id: '1-0', message: { data: JSON.stringify({ id: 'a' }) } }
            ];
            mockRedisClient.getStreamInfo.mockResolvedValue({ 'last-entry': { id: '5-0' } });
            mockRedisClient.readFromStream.mockResolvedValue([{ messages }]);

            const result = await manager.readBundleEntriesFromStream('key-1', '0-0');
            expect(result.hasMore).toBe(true);
            expect(result.lastId).toBe('1-0');
        });

        test('uses REDIS_STREAM_READ_COUNT from env as stream count', async () => {
            process.env.REDIS_STREAM_READ_COUNT = '50';
            mockRedisClient.readFromStream.mockResolvedValue(null);
            // Recreate manager to pick up env
            const mgr = new RedisStreamManager({ redisClient: mockRedisClient });
            await mgr.readBundleEntriesFromStream('key-1', '0-0');
            expect(mockRedisClient.readFromStream).toHaveBeenCalledWith('key-1', '0-0', 50);
        });

        test('defaults stream count to 100 when env not set', async () => {
            mockRedisClient.readFromStream.mockResolvedValue(null);
            await manager.readBundleEntriesFromStream('key-1', '0-0');
            expect(mockRedisClient.readFromStream).toHaveBeenCalledWith('key-1', '0-0', 100);
        });

        test('logs error and captures exception on failure', async () => {
            const error = new Error('Read error');
            mockRedisClient.getStreamInfo.mockRejectedValue(error);

            await manager.readBundleEntriesFromStream('key-1', '0-0');

            expect(logError).toHaveBeenCalledWith(
                'Error reading from Redis stream',
                expect.objectContaining({ error, cacheKey: 'key-1' })
            );
            expect(captureException).toHaveBeenCalledWith(error);
        });
    });

    describe('deleteStream', () => {
        test('connects to Redis before deleting', async () => {
            await manager.deleteStream('key-1');
            expect(mockRedisClient.connectAsync).toHaveBeenCalled();
        });

        test('calls deleteKey with the cache key', async () => {
            await manager.deleteStream('key-1');
            expect(mockRedisClient.deleteKey).toHaveBeenCalledWith('key-1');
        });

        test('logs error on failure but does not throw', async () => {
            const error = new Error('Delete failed');
            mockRedisClient.deleteKey.mockRejectedValue(error);

            await expect(manager.deleteStream('key-1')).resolves.toBeUndefined();
            expect(logError).toHaveBeenCalledWith(
                'Error deleting Redis stream',
                expect.objectContaining({ error, cacheKey: 'key-1' })
            );
        });

        test('captures exception on failure', async () => {
            const error = new Error('Delete failed');
            mockRedisClient.deleteKey.mockRejectedValue(error);

            await manager.deleteStream('key-1');
            expect(captureException).toHaveBeenCalledWith(error);
        });
    });
});
