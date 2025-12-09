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
        let redisConnected = true;
        if (!this.client.isOpen) {
            await this.client.connect().catch((e) => {
                logError('Error connecting to Redis', { error: e });
                captureException(e);
                redisConnected = false;
            });
        }
        return redisConnected;
    }

    async get(key) {
        return await this.client.get(key);
    }

    async set(key, value, ttlSeconds = env.REDIS_KEY_DEFAULT_TTL_SECONDS) {
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
    async addStreamEntry(streamKey, data, ttlSeconds = env.REDIS_KEY_DEFAULT_TTL_SECONDS) {
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

}

module.exports = {
    RedisClient
};

