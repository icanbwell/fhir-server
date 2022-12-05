const {assertIsValid} = require('./assertType');
const {logSystemEventAsync} = require('../operations/common/logging');

class RequestSpecificCache {
    constructor() {
        /**
         * This is a Map where the key is requestId and the value is
         * another Map where the key is the name and value is the Map corresponding to that name
         * @type {Map<string, Map<string, Map>>}
         */
        this.mapCache = new Map();

        /**
         * This is a Map where the key is the requestId and the value is
         * another Map where the key is the name and the value is a list/array
         * @type {Map<string, Map<string, []>>}
         */
        this.listCache = new Map();
    }

    /**
     * gets a cache by name and requestId
     * @param {string} requestId
     * @param  {string} name
     * @returns {Map}
     */
    getMap({requestId, name}) {
        assertIsValid(requestId, 'requestId is null');
        assertIsValid(name, 'name is null');
        if (!this.mapCache.has(requestId)) {
            this.mapCache.set(requestId, new Map());
        }
        const mapsForRequest = this.mapCache.get(requestId);
        if (!mapsForRequest.has(name)) {
            mapsForRequest.set(name, new Map());
        }
        return mapsForRequest.get(name);
    }

    /**
     * gets a cache by name and requestId
     * @param {string} requestId
     * @param  {string} name
     * @returns {*[]}
     */
    getList({requestId, name}) {
        assertIsValid(requestId, 'requestId is null');
        assertIsValid(name, 'name is null');
        if (!this.listCache.has(requestId)) {
            this.listCache.set(requestId, new Map());
        }
        const listsForRequest = this.listCache.get(requestId);
        if (!listsForRequest.has(name)) {
            listsForRequest.set(name, []);
        }
        return listsForRequest.get(name);
    }

    /**
     * Gets all request ids
     * @return {string[]}
     */
    getRequestIds() {
        return Array.from(new Set(Array.from(this.mapCache.keys()).concat(Array.from(this.listCache.keys()))));
    }

    /**
     * clears the cache for this requestId
     * @param requestId
     */
    async clearAsync({requestId}) {
        await logSystemEventAsync(
            {
                event: 'clearAsync',
                message: `clearAsync: ${requestId}`,
                args: {
                    requestId: requestId,
                }
            }
        );
        if (!this.mapCache.has(requestId)) {
            this.mapCache.delete(requestId);
        }
        if (!this.listCache.has(requestId)) {
            this.listCache.delete(requestId);
        }
    }

    /**
     * clears the cache for all request ids
     */
    async clearAllAsync() {
        for (const requestId of this.getRequestIds()) {
            await this.clearAsync({requestId});
        }
    }
}

module.exports = {
    RequestSpecificCache
};
