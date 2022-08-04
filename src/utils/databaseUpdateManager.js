const {getOrCreateCollectionForResourceTypeAsync} = require('../operations/common/resourceManager');

class DatabaseUpdateManager {
    /**
     *
     * @param {string} resourceType
     * @param {string} base_version
     * @param {boolean} useAtlas
     */
    constructor(resourceType, base_version, useAtlas) {
        /**
         * @type {string}
         * @private
         */
        this._resourceType = resourceType;
        /**
         * @type {string}
         * @private
         */
        this._base_version = base_version;
        /**
         * @type {boolean}
         * @private
         */
        this._useAtlas = useAtlas;
    }

    /**
     * @param {Resource} doc
     * @return {Promise<void>}
     */
    async insertOne(doc) {
        const collection = await getOrCreateCollectionForResourceTypeAsync(this._resourceType, this._base_version, this._useAtlas, doc);
        await collection.insertOne(doc);
    }
}

module.exports = {
    DatabaseUpdateManager
};
