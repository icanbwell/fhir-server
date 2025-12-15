class MockRedisClient {
    constructor() {
        this.store = new Map();
        this.streams = new Map();
        this.connected = false;
    }

    async connectAsync() {
        if (!this.connected) {
            this.connected = true;
        }
        return true;
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
    async set(key, value, ttlSeconds = 600) {
        this.store.set(key, value);
    }

    /**
     * Fetch key from redis
     * @param {string} key
     */
    async get(key) {
        return this.store.get(key);
    }

    async deleteKey(key) {
        this.store.delete(key);
        this.streams.delete(key);
    }

    /**
     * Add entry to Redis Stream
     * @param {string} streamKey
     * @param {string} data
     * @param {number} ttlSeconds
     * @returns {Promise<void>}
     */
    async addStreamEntry(streamKey, data, ttlSeconds = 600) {
        if (!this.streams.has(streamKey)) {
            this.streams.set(streamKey, []);
        }

        const entryId = `${Date.now()}-${this.streams.get(streamKey).length}`;
        this.streams.get(streamKey).push({
            id: entryId,
            message: {
                data: data,
                timestamp: Date.now().toString()
            }
        });
    }
}

module.exports = {
    MockRedisClient
};
