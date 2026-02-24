const {isTrue, isTrueWithFallback} = require('./isTrue')
const { createClient, ReconnectStrategyError } = require('redis');
const { logError, logInfo } = require('../operations/common/logging');
const { captureException } = require('../operations/common/sentry');

/**
 * This class implements a client to Redis
 */
const env = process.env;

class RedisClient {
    constructor() {
        let redisConfig = {
            socket: {
                host: env.REDIS_HOST || undefined,
                port: parseInt(env.REDIS_PORT) || 6379,
                tls: isTrueWithFallback(env.REDIS_ENABLE_TLS, true),
                reconnectStrategy: false,
                rejectUnauthorized: isTrueWithFallback(env.REDIS_REJECT_UNAUTHORIZED_FLAG, false)
            }
        };
        if (env.REDIS_USERNAME !== undefined) {
            redisConfig.username = env.REDIS_USERNAME;
            redisConfig.password = env.REDIS_PASSWORD || '';
        }
        this.client = createClient(redisConfig);
        this.defaultTtlSeconds = parseInt(env.REDIS_KEY_DEFAULT_TTL_SECONDS) || 600;
        this.invalidateCacheKeysBatchSize = parseInt(env.REDIS_INVALIDATE_CACHE_KEYS_BATCH_SIZE) || 500;

        this.client.on('error', (err) => logError('Redis Client Error', err));
        this.client.on('connect', () => {
            logInfo('Redis client connecting');
        });
        this.client.on('ready', () => {
            logInfo('Redis client connected');
        });
        this.client.on('end', () => {
            logInfo('Redis client disconnected');
        });
    }

    async connectAsync() {
        if (!this.client.isOpen) {
            await this.client.connect().catch((e) => {
                logError('Error connecting to Redis', { error: e });
                captureException(e);
            });
        }
    }

    async get(key) {
        return await this.client.get(key);
    }

    async incr(key) {
        return await this.client.incr(key);
    }

    async set(key, value, ttlSeconds = null) {
        ttlSeconds = ttlSeconds || this.defaultTtlSeconds;
        if (ttlSeconds && !isNaN(parseInt(ttlSeconds))) {
            await this.client.set(key, value, { EX: parseInt(ttlSeconds) });
        } else {
            await this.client.set(key, value);
        }
    }

    /**
     * Add an entry to a Redis Stream
     * @param {string} streamKey
     * @param {*} data
     * @param {number} ttlSeconds
     */
    async addStreamEntry(streamKey, data, ttlSeconds = null) {
        ttlSeconds = ttlSeconds || this.defaultTtlSeconds;
        await this.client.xAdd(
            streamKey,
            '*',
            {
                data: data,
                timestamp: Date.now().toString()
            }
        );
        if (ttlSeconds && !isNaN(parseInt(ttlSeconds))) {
            await this.client.expire(streamKey, parseInt(ttlSeconds));
        }
    }

    /**
     * Delete a Redis Stream
     * @param {string} key
     * @returns {Promise<void>}
     */
    async deleteKey(key) {
        await this.client.del(key);
    }

    /**
     * Check if a key exists in Redis
     * @param {string} key
     * @returns {Promise<boolean>}
     */
    async hasKey(key) {
        const exists = await this.client.exists(key);
        return exists === 1;
    }

    /**
     * Read entries from a Redis Stream
     * @param {string} streamKey
     * @param {string} lastId
     * @param {number} count
     * @returns {Promise<Array>}
     */
    async readFromStream(streamKey, lastId = '0-0', count=500) {
        return await this.client.xRead(
            { key: streamKey, id: lastId },
            { COUNT: count, BLOCK: 0 }
        );
    }

    async checkConnectionHealth() {
        let healthy = true;
        if (isTrue(env.ENABLE_REDIS)) {
            try {
                await this.connectAsync();
                await this.client.ping();
            } catch (e) {
                logError('Redis health check failed', { error: e });
                captureException(e);
                healthy = false;
            }
        }
        return healthy;
    }

    /**
     * Get information about a Redis Stream
     * @param {string} cacheKey
     * @returns {Promise<Object>}
     */
    async getStreamInfo(cacheKey) {
        return await this.client.xInfoStream(cacheKey);
    }

    /**
     * Bulk delete keys from Redis
     * @param {string[]} keys
     */
    async bulkDeleteKeys(keys) {
        let deleteCommands = [];
        if (keys.length > 0) {
            keys.forEach(key => deleteCommands.push(this.client.del(key)));
            await Promise.all(deleteCommands);
        }
    }

    /**
     * Invalidates cache keys by prefix
     * @param {string} prefix
     * @returns {Promise<void>}
     */
    async invalidateByPrefixAsync(prefix) {
        const pattern = prefix + '*';
        for await (let keys of this.client.scanIterator({ MATCH: pattern, COUNT: this.invalidateCacheKeysBatchSize })) {
            await this.bulkDeleteKeys(keys);
        }
    }

    /**
     * Retrieves all keys from Redis that match a given prefix
     * @param {string} prefix
     * @returns {Promise<string[]>}
     */
    async getAllKeysByPrefix(prefix) {
        const pattern = prefix + '*';
        const keys = [];
        for await (let batch of this.client.scanIterator({ MATCH: pattern, COUNT: this.invalidateCacheKeysBatchSize })) {
            keys.push(...batch);
        }
        return keys;
    }

    // ==================== Pub/Sub Methods for SSE Subscriptions ====================

    /**
     * Create a duplicate client for Pub/Sub subscriber (required by Redis)
     * @returns {Promise<Object>}
     */
    async createSubscriberClientAsync() {
        await this.connectAsync();
        const subscriber = this.client.duplicate();
        await subscriber.connect();
        return subscriber;
    }

    /**
     * Publish a message to a channel
     * @param {string} channel - The channel name
     * @param {string} message - The message to publish (JSON stringified)
     * @returns {Promise<number>} - Number of subscribers that received the message
     */
    async publishAsync(channel, message) {
        await this.connectAsync();
        return await this.client.publish(channel, message);
    }

    /**
     * Subscribe to a channel pattern (e.g., 'fhir:sse:*')
     * @param {string} pattern - The channel pattern
     * @param {function} callback - Callback function (pattern, channel, message)
     * @returns {Promise<Object>} - Subscriber client (needed to unsubscribe)
     */
    async pSubscribeAsync(pattern, callback) {
        const subscriber = await this.createSubscriberClientAsync();
        await subscriber.pSubscribe(pattern, (message, channel) => {
            callback(pattern, channel, message);
        });
        return subscriber;
    }

    /**
     * Subscribe to a specific channel
     * @param {string} channel - The channel name
     * @param {function} callback - Callback function (message, channel)
     * @returns {Promise<Object>} - Subscriber client
     */
    async subscribeAsync(channel, callback) {
        const subscriber = await this.createSubscriberClientAsync();
        await subscriber.subscribe(channel, (message) => {
            callback(message, channel);
        });
        return subscriber;
    }

    /**
     * Unsubscribe from pattern and quit subscriber client
     * @param {Object} subscriber - The subscriber client
     * @param {string} [pattern] - Optional pattern to unsubscribe from
     */
    async pUnsubscribeAsync(subscriber, pattern = null) {
        if (subscriber) {
            if (pattern) {
                await subscriber.pUnsubscribe(pattern);
            }
            await subscriber.quit();
        }
    }

    /**
     * Set a hash field
     * @param {string} key - Hash key
     * @param {string} field - Field name
     * @param {string} value - Field value
     * @param {number} [ttlSeconds] - Optional TTL
     */
    async hSetAsync(key, field, value, ttlSeconds = null) {
        await this.connectAsync();
        await this.client.hSet(key, field, value);
        if (ttlSeconds && !isNaN(parseInt(ttlSeconds))) {
            await this.client.expire(key, parseInt(ttlSeconds));
        }
    }

    /**
     * Get a hash field
     * @param {string} key - Hash key
     * @param {string} field - Field name
     * @returns {Promise<string|null>}
     */
    async hGetAsync(key, field) {
        await this.connectAsync();
        return await this.client.hGet(key, field);
    }

    /**
     * Get all fields and values from a hash
     * @param {string} key - Hash key
     * @returns {Promise<Object>}
     */
    async hGetAllAsync(key) {
        await this.connectAsync();
        return await this.client.hGetAll(key);
    }

    /**
     * Delete a hash field
     * @param {string} key - Hash key
     * @param {string} field - Field name
     * @returns {Promise<number>}
     */
    async hDelAsync(key, field) {
        await this.connectAsync();
        return await this.client.hDel(key, field);
    }

    /**
     * Get the number of fields in a hash
     * @param {string} key - Hash key
     * @returns {Promise<number>}
     */
    async hLenAsync(key) {
        await this.connectAsync();
        return await this.client.hLen(key);
    }
}

module.exports = {
    RedisClient
};

