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

    /**
     * Increment a key's value in redis
     * @param {string} key
     * @returns {Promise<number>} new value after increment
     */
    async incr(key) {
        const storedValue = this.store.get(key);
        const parsedCurrent =
            storedValue === undefined ? 0 : parseInt(storedValue, 10);
        const currentValue = Number.isNaN(parsedCurrent) ? 0 : parsedCurrent;
        const newValue = currentValue + 1;
        this.store.set(key, `${newValue}`);
        return newValue;
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

    async hasKey(key) {
        return this.store.has(key) || this.streams.has(key);
    }

    async readFromStream(streamKey, lastId = '0-0', count=500) {
        if (!this.streams.has(streamKey)) {
            return null;
        }

        const entries = this.streams.get(streamKey);
        const startIndex = lastId === '0-0' ? 0 : entries.findIndex(e => e.id === lastId) + 1;

        if (startIndex === -1 || startIndex >= entries.length) {
            return null;
        }

        const result = entries.slice(startIndex, startIndex + count);

        if (result.length === 0) {
            return null;
        }

        return [{
            name: streamKey,
            messages: result
        }];
    }

    async getStreamInfo(cacheKey) {
         if (!this.streams.has(cacheKey)) {
            throw new Error(`Stream ${cacheKey} does not exist`);
        }

        const entries = this.streams.get(cacheKey);
        const firstEntry = entries[0];
        const lastEntry = entries[entries.length - 1];

        return {
            length: entries.length,
            'first-entry': firstEntry ? [firstEntry.id, firstEntry.message] : null,
            'last-entry': lastEntry ? [lastEntry.id, lastEntry.message] : null,
            groups: 0
        };
    }

    /**
     * Bulk delete keys from Redis
     * @param {string[]} keys
     * @returns {Promise<void>}
     */
    async bulkDeleteKeys(keys) {
        if (!keys || keys.length === 0) {
            return;
        }

        for (const key of keys) {
            this.store.delete(key);
            this.streams.delete(key);
        }
    }

    /**
     * Get all keys matching a prefix pattern
     * @param {string} prefix
     * @returns {Promise<string[]>}
     */
    async getAllKeysByPrefix(prefix) {
        const matchingKeys = [];

        // Find all keys in store that match the prefix
        for (const key of this.store.keys()) {
            if (key.startsWith(prefix)) {
                matchingKeys.push(key);
            }
        }

        // Find all stream keys that match the prefix
        for (const key of this.streams.keys()) {
            if (key.startsWith(prefix)) {
                matchingKeys.push(key);
            }
        }

        return matchingKeys;
    }

    /**
     * Invalidates cache keys by prefix
     * @param {string} prefix
     * @returns {Promise<void>}
     */
    async invalidateByPrefixAsync(prefix) {
        // Get all keys matching the prefix
        const keysToDelete = await this.getAllKeysByPrefix(prefix);

        // Bulk delete them
        await this.bulkDeleteKeys(keysToDelete);
    }
};

module.exports = {
    MockRedisClient
};
