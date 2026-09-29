/**
 * Unit tests for RedisClient
 */
const { describe, test, expect, beforeEach, afterEach, jest: jestObj } = require('@jest/globals');

// Mock redis client methods
const mockGet = jestObj.fn().mockResolvedValue(null);
const mockSet = jestObj.fn().mockResolvedValue('OK');
const mockIncr = jestObj.fn().mockResolvedValue(1);
const mockDel = jestObj.fn().mockResolvedValue(1);
const mockExists = jestObj.fn().mockResolvedValue(0);
const mockConnect = jestObj.fn().mockResolvedValue(undefined);
const mockPing = jestObj.fn().mockResolvedValue('PONG');
const mockXAdd = jestObj.fn().mockResolvedValue('1234567890-0');
const mockXRead = jestObj.fn().mockResolvedValue([]);
const mockXInfoStream = jestObj.fn().mockResolvedValue({ length: 5 });
const mockExpire = jestObj.fn().mockResolvedValue(true);
const mockOn = jestObj.fn();
const mockScanIterator = jestObj.fn();

const mockRedisClient = {
    get: mockGet,
    set: mockSet,
    incr: mockIncr,
    del: mockDel,
    exists: mockExists,
    connect: mockConnect,
    ping: mockPing,
    xAdd: mockXAdd,
    xRead: mockXRead,
    xInfoStream: mockXInfoStream,
    expire: mockExpire,
    on: mockOn,
    scanIterator: mockScanIterator,
    isOpen: false
};

jestObj.mock('redis', () => ({
    createClient: jestObj.fn().mockReturnValue(mockRedisClient),
    ReconnectStrategyError: class ReconnectStrategyError extends Error {}
}));

jestObj.mock('../../../operations/common/logging', () => ({
    logError: jestObj.fn(),
    logInfo: jestObj.fn()
}));

jestObj.mock('../../../operations/common/sentry', () => ({
    captureException: jestObj.fn()
}));

jestObj.mock('../../../utils/isTrue', () => ({
    isTrue: jestObj.fn((s) => String(s).toLowerCase() === 'true' || String(s).toLowerCase() === '1'),
    isTrueWithFallback: jestObj.fn((s, fallback) => s === null || s === undefined ? fallback : String(s).toLowerCase() === 'true' || String(s).toLowerCase() === '1')
}));

const { logError, logInfo } = require('../../../operations/common/logging');
const { captureException } = require('../../../operations/common/sentry');
const { createClient } = require('redis');

describe('RedisClient', () => {
    let RedisClient;
    let redisClient;
    let originalEnv;

    beforeEach(() => {
        jestObj.clearAllMocks();
        originalEnv = { ...process.env };

        // Set default env vars
        process.env.REDIS_HOST = 'localhost';
        process.env.REDIS_PORT = '6380';
        process.env.REDIS_ENABLE_TLS = 'true';
        process.env.REDIS_KEY_DEFAULT_TTL_SECONDS = '300';
        process.env.REDIS_INVALIDATE_CACHE_KEYS_BATCH_SIZE = '100';

        mockRedisClient.isOpen = false;

        // Re-require to get fresh module with current env
        jestObj.isolateModules(() => {
            ({ RedisClient } = require('../../../utils/redisClient'));
        });

        redisClient = new RedisClient();
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    describe('constructor', () => {
        test('creates redis client with correct config', () => {
            expect(createClient).toHaveBeenCalled();
        });

        test('sets defaultTtlSeconds from environment', () => {
            expect(redisClient.defaultTtlSeconds).toBe(300);
        });

        test('sets invalidateCacheKeysBatchSize from environment', () => {
            expect(redisClient.invalidateCacheKeysBatchSize).toBe(100);
        });

        test('defaults defaultTtlSeconds to 600 when env not set', () => {
            delete process.env.REDIS_KEY_DEFAULT_TTL_SECONDS;
            let NewRedisClient;
            jestObj.isolateModules(() => {
                ({ RedisClient: NewRedisClient } = require('../../../utils/redisClient'));
            });
            const client = new NewRedisClient();
            expect(client.defaultTtlSeconds).toBe(600);
        });

        test('defaults invalidateCacheKeysBatchSize to 500 when env not set', () => {
            delete process.env.REDIS_INVALIDATE_CACHE_KEYS_BATCH_SIZE;
            let NewRedisClient;
            jestObj.isolateModules(() => {
                ({ RedisClient: NewRedisClient } = require('../../../utils/redisClient'));
            });
            const client = new NewRedisClient();
            expect(client.invalidateCacheKeysBatchSize).toBe(500);
        });

        test('registers error event handler', () => {
            expect(mockOn).toHaveBeenCalledWith('error', expect.any(Function));
        });

        test('registers connect event handler', () => {
            expect(mockOn).toHaveBeenCalledWith('connect', expect.any(Function));
        });

        test('registers ready event handler', () => {
            expect(mockOn).toHaveBeenCalledWith('ready', expect.any(Function));
        });

        test('registers end event handler', () => {
            expect(mockOn).toHaveBeenCalledWith('end', expect.any(Function));
        });

        test('error handler logs error', () => {
            const errorHandler = mockOn.mock.calls.find(call => call[0] === 'error')[1];
            const testError = new Error('Redis error');
            errorHandler(testError);
            expect(logError).toHaveBeenCalledWith('Redis Client Error', testError);
        });

        test('connect handler logs info', () => {
            const connectHandler = mockOn.mock.calls.find(call => call[0] === 'connect')[1];
            connectHandler();
            expect(logInfo).toHaveBeenCalledWith('Redis client connecting');
        });

        test('ready handler logs info', () => {
            const readyHandler = mockOn.mock.calls.find(call => call[0] === 'ready')[1];
            readyHandler();
            expect(logInfo).toHaveBeenCalledWith('Redis client connected');
        });

        test('end handler logs info', () => {
            const endHandler = mockOn.mock.calls.find(call => call[0] === 'end')[1];
            endHandler();
            expect(logInfo).toHaveBeenCalledWith('Redis client disconnected');
        });

        test('includes username and password when REDIS_USERNAME is set', () => {
            process.env.REDIS_USERNAME = 'admin';
            process.env.REDIS_PASSWORD = 'secret';
            let NewRedisClient;
            jestObj.isolateModules(() => {
                ({ RedisClient: NewRedisClient } = require('../../../utils/redisClient'));
            });
            new NewRedisClient();
            const config = createClient.mock.calls[createClient.mock.calls.length - 1][0];
            expect(config.username).toBe('admin');
            expect(config.password).toBe('secret');
        });

        test('does not include username/password when REDIS_USERNAME is not set', () => {
            delete process.env.REDIS_USERNAME;
            let NewRedisClient;
            jestObj.isolateModules(() => {
                ({ RedisClient: NewRedisClient } = require('../../../utils/redisClient'));
            });
            new NewRedisClient();
            const config = createClient.mock.calls[createClient.mock.calls.length - 1][0];
            expect(config.username).toBeUndefined();
            expect(config.password).toBeUndefined();
        });
    });

    describe('connectAsync', () => {
        test('connects when client is not open', async () => {
            mockRedisClient.isOpen = false;
            await redisClient.connectAsync();
            expect(mockConnect).toHaveBeenCalled();
        });

        test('does not connect when client is already open', async () => {
            mockRedisClient.isOpen = true;
            await redisClient.connectAsync();
            expect(mockConnect).not.toHaveBeenCalled();
        });

        test('logs error and captures exception when connect fails', async () => {
            mockRedisClient.isOpen = false;
            const connError = new Error('Connection refused');
            mockConnect.mockRejectedValueOnce(connError);
            await redisClient.connectAsync();
            expect(logError).toHaveBeenCalledWith('Error connecting to Redis', { error: connError });
            expect(captureException).toHaveBeenCalledWith(connError);
        });
    });

    describe('get', () => {
        test('returns value for existing key', async () => {
            mockGet.mockResolvedValue('stored-value');
            const result = await redisClient.get('my-key');
            expect(result).toBe('stored-value');
            expect(mockGet).toHaveBeenCalledWith('my-key');
        });

        test('returns null for non-existing key', async () => {
            mockGet.mockResolvedValue(null);
            const result = await redisClient.get('missing-key');
            expect(result).toBeNull();
        });
    });

    describe('incr', () => {
        test('increments key and returns new value', async () => {
            mockIncr.mockResolvedValue(5);
            const result = await redisClient.incr('counter');
            expect(result).toBe(5);
            expect(mockIncr).toHaveBeenCalledWith('counter');
        });
    });

    describe('set', () => {
        test('sets key with default TTL when no ttlSeconds provided', async () => {
            await redisClient.set('key1', 'value1');
            expect(mockSet).toHaveBeenCalledWith('key1', 'value1', { EX: 300 });
        });

        test('sets key with custom TTL', async () => {
            await redisClient.set('key1', 'value1', 60);
            expect(mockSet).toHaveBeenCalledWith('key1', 'value1', { EX: 60 });
        });

        test('sets key with TTL as string number', async () => {
            await redisClient.set('key1', 'value1', '120');
            expect(mockSet).toHaveBeenCalledWith('key1', 'value1', { EX: 120 });
        });

        test('sets key without TTL when ttlSeconds is NaN', async () => {
            await redisClient.set('key1', 'value1', 'invalid');
            expect(mockSet).toHaveBeenCalledWith('key1', 'value1');
        });
    });

    describe('addStreamEntry', () => {
        test('adds entry to stream with default TTL', async () => {
            await redisClient.addStreamEntry('stream-key', 'data-payload');
            expect(mockXAdd).toHaveBeenCalledWith(
                'stream-key',
                '*',
                expect.objectContaining({ data: 'data-payload' })
            );
            expect(mockExpire).toHaveBeenCalledWith('stream-key', 300);
        });

        test('adds entry to stream with custom TTL', async () => {
            await redisClient.addStreamEntry('stream-key', 'data-payload', 60);
            expect(mockExpire).toHaveBeenCalledWith('stream-key', 60);
        });

        test('includes timestamp in stream entry', async () => {
            const beforeTime = Date.now();
            await redisClient.addStreamEntry('stream-key', 'data-payload');
            const callArgs = mockXAdd.mock.calls[0][2];
            const timestamp = parseInt(callArgs.timestamp);
            expect(timestamp).toBeGreaterThanOrEqual(beforeTime);
            expect(timestamp).toBeLessThanOrEqual(Date.now());
        });
    });

    describe('deleteKey', () => {
        test('deletes the specified key', async () => {
            await redisClient.deleteKey('my-key');
            expect(mockDel).toHaveBeenCalledWith('my-key');
        });
    });

    describe('hasKey', () => {
        test('returns true when key exists', async () => {
            mockExists.mockResolvedValue(1);
            const result = await redisClient.hasKey('existing-key');
            expect(result).toBe(true);
        });

        test('returns false when key does not exist', async () => {
            mockExists.mockResolvedValue(0);
            const result = await redisClient.hasKey('missing-key');
            expect(result).toBe(false);
        });
    });

    describe('readFromStream', () => {
        test('reads from stream with default parameters', async () => {
            const mockMessages = [{ id: '1-0', message: { data: 'test' } }];
            mockXRead.mockResolvedValue(mockMessages);
            const result = await redisClient.readFromStream('stream-key');
            expect(mockXRead).toHaveBeenCalledWith(
                { key: 'stream-key', id: '0-0' },
                { COUNT: 500, BLOCK: 0 }
            );
            expect(result).toEqual(mockMessages);
        });

        test('reads from stream with custom lastId and count', async () => {
            await redisClient.readFromStream('stream-key', '1234-0', 100);
            expect(mockXRead).toHaveBeenCalledWith(
                { key: 'stream-key', id: '1234-0' },
                { COUNT: 100, BLOCK: 0 }
            );
        });
    });

    describe('checkConnectionHealth', () => {
        test('returns true when Redis is healthy', async () => {
            process.env.ENABLE_REDIS = 'true';
            mockRedisClient.isOpen = false;
            mockConnect.mockResolvedValue(undefined);
            mockPing.mockResolvedValue('PONG');

            const result = await redisClient.checkConnectionHealth();
            expect(result).toBe(true);
        });

        test('returns false when ping fails', async () => {
            process.env.ENABLE_REDIS = 'true';
            mockRedisClient.isOpen = true; // Skip connect
            mockPing.mockRejectedValue(new Error('Connection lost'));

            const result = await redisClient.checkConnectionHealth();
            expect(result).toBe(false);
            expect(logError).toHaveBeenCalledWith('Redis health check failed', expect.any(Object));
            expect(captureException).toHaveBeenCalled();
        });

        test('returns true when ENABLE_REDIS is not true (skips check)', async () => {
            process.env.ENABLE_REDIS = 'false';
            const result = await redisClient.checkConnectionHealth();
            expect(result).toBe(true);
            expect(mockPing).not.toHaveBeenCalled();
        });

        test('returns true when ENABLE_REDIS is not set (skips check)', async () => {
            delete process.env.ENABLE_REDIS;
            const result = await redisClient.checkConnectionHealth();
            expect(result).toBe(true);
            expect(mockPing).not.toHaveBeenCalled();
        });
    });

    describe('getStreamInfo', () => {
        test('returns stream info for given cache key', async () => {
            const streamInfo = { length: 10, firstEntry: '1-0', lastEntry: '10-0' };
            mockXInfoStream.mockResolvedValue(streamInfo);
            const result = await redisClient.getStreamInfo('my-stream');
            expect(mockXInfoStream).toHaveBeenCalledWith('my-stream');
            expect(result).toEqual(streamInfo);
        });
    });

    describe('bulkDeleteKeys', () => {
        test('deletes all specified keys', async () => {
            await redisClient.bulkDeleteKeys(['key1', 'key2', 'key3']);
            expect(mockDel).toHaveBeenCalledTimes(3);
            expect(mockDel).toHaveBeenCalledWith('key1');
            expect(mockDel).toHaveBeenCalledWith('key2');
            expect(mockDel).toHaveBeenCalledWith('key3');
        });

        test('does nothing when keys array is empty', async () => {
            await redisClient.bulkDeleteKeys([]);
            expect(mockDel).not.toHaveBeenCalled();
        });
    });

    describe('invalidateByPrefixAsync', () => {
        test('deletes all keys matching prefix pattern', async () => {
            // Simulate async iterator returning batches of keys
            const asyncIterator = (async function* () {
                yield ['prefix:key1', 'prefix:key2'];
                yield ['prefix:key3'];
            })();
            mockScanIterator.mockReturnValue(asyncIterator);

            await redisClient.invalidateByPrefixAsync('prefix:');
            expect(mockScanIterator).toHaveBeenCalledWith({
                MATCH: 'prefix:*',
                COUNT: 100
            });
            expect(mockDel).toHaveBeenCalledTimes(3);
        });

        test('handles empty scan results', async () => {
            const asyncIterator = (async function* () {
                // No yields - empty iterator
            })();
            mockScanIterator.mockReturnValue(asyncIterator);

            await redisClient.invalidateByPrefixAsync('nonexistent:');
            expect(mockDel).not.toHaveBeenCalled();
        });
    });

    describe('getAllKeysByPrefix', () => {
        test('returns all keys matching prefix', async () => {
            const asyncIterator = (async function* () {
                yield ['prefix:key1', 'prefix:key2'];
                yield ['prefix:key3'];
            })();
            mockScanIterator.mockReturnValue(asyncIterator);

            const keys = await redisClient.getAllKeysByPrefix('prefix:');
            expect(keys).toEqual(['prefix:key1', 'prefix:key2', 'prefix:key3']);
            expect(mockScanIterator).toHaveBeenCalledWith({
                MATCH: 'prefix:*',
                COUNT: 100
            });
        });

        test('returns empty array when no keys match', async () => {
            const asyncIterator = (async function* () {})();
            mockScanIterator.mockReturnValue(asyncIterator);

            const keys = await redisClient.getAllKeysByPrefix('nonexistent:');
            expect(keys).toEqual([]);
        });
    });
});
