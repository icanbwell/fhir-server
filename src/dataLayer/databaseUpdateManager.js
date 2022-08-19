const assert = require('node:assert/strict');

/**
 * This class manages inserts and updates to the database
 */
class DatabaseUpdateManager {
    /**
     * Constructor
     * @param {ResourceLocatorFactory} resourceLocatorFactory
     * @param {string} resourceType
     * @param {string} base_version
     * @param {boolean} useAtlas
     */
    constructor(resourceLocatorFactory, resourceType, base_version, useAtlas) {
        assert(resourceLocatorFactory);
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
        /**
         * @type {ResourceLocator}
         */
        this.resourceLocator = resourceLocatorFactory.createResourceLocator(this._resourceType,
            this._base_version, this._useAtlas);
    }

    /**
     * Inserts a resource into the database
     * @param {Resource} doc
     * @return {Promise<void>}
     */
    async insertOneAsync(doc) {
        const collection = await this.resourceLocator.getOrCreateCollectionForResourceAsync(doc);
        await collection.insertOne(doc);
    }
}

module.exports = {
    DatabaseUpdateManager
};
