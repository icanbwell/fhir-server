const {isTrue} = require('./isTrue')
const { createClient } = require('redis');
const { logError, logInfo } = require('../operations/common/logging');
const { captureException } = require('../operations/common/sentry');

/**
 * This class implements a client to Redis
 */
const env = process.env;

class RedisClient {
    constructor() {
        this.client = createClient({
            url: env.REDIS_URL || undefined,
            username: env.REDIS_USERNAME || undefined,
            password: env.REDIS_PASSWORD || undefined,
            socket: {
                reconnectStrategy: false
            }
        });

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

    async set(key, value, ttlSeconds = env.REDIS_KEY_DEFAULT_TTL_SECONDS) {
        if (ttlSeconds && !isNaN(parseInt(ttlSeconds))) {
            await this.client.set(key, value, { EX: parseInt(ttlSeconds) });
        } else {
            await this.client.set(key, value);
        }
    }

    async checkConnectionHealth() {
        let healthy = true;
        if (isTrue(env.ENABLE_REDIS_IN_HEALTH_CHECK)) {
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

