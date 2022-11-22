class RequestSpecificCache {
    constructor() {
        /**
         * This is a Map where the key is requestId and the value is
         * another Map where the key is the name and value is the Map corresponding to that name
         * @type {Map<string, Map<string, Map>>}
         */
        this.cache = new Map();
    }

    /**
     * gets a cache by name and requestId
     * @param requestId
     * @param name
     * @returns {Map}
     */
    get({requestId, name}) {
        if (!this.cache.has(requestId)) {
            this.cache.set(requestId, new Map());
        }
        const mapsForRequest = this.cache.get(requestId);
        if (!mapsForRequest.has(name)) {
            mapsForRequest.set(name, new Map());
        }
        return mapsForRequest.get(name);
    }

    /**
     * clears the cache for this requestId
     * @param requestId
     */
    clear({requestId}) {
        if (!this.cache.has(requestId)) {
            this.cache.delete(requestId);
        }
    }
}

module.exports = {
    RequestSpecificCache
};
