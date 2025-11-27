const { RedisClient } = require('../../utils/redisClient');


class MockRedisClient extends RedisClient {
    constructor() {
        super();
        this.store = new Map();
        this.connected = false;
    }

    async connectAsync() {
        if (!this.connected) this.connected = true;
    }

    async checkConnectionHealth() {
        await this.connectAsync();
        return true;
    }

    /**
     * Set key in redis
     * @param {string} key
     * @param {string} value
     * @param {number|null|undefined} ttlSeconds
    */
    set(key, value, ttlSeconds = 600) {
        this.store.set(key, value);
    }

    /**
     * Fetch key from redis
     * @param {string} key
    */
    get(key) {
        return this.store.get(key);
    }

    clear() {
        this.store.clear();
    }
}

module.exports = {
    MockRedisClient
};