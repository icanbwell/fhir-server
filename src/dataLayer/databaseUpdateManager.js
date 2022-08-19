const {ResourceLocator} = require('../operations/common/resourceLocator');

/**
 * This class manages inserts and updates to the database
 */
class DatabaseUpdateManager {
    /**
     * Constructor
     * @param {MongoCollectionManager} collectionManager
     * @param {string} resourceType
     * @param {string} base_version
     * @param {boolean} useAtlas
     */
    constructor(collectionManager, resourceType, base_version, useAtlas) {
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
         * @type {MongoCollectionManager}
         */
        this.collectionManager = collectionManager;
    }

    /**
     * Inserts a resource into the database
     * @param {Resource} doc
     * @return {Promise<void>}
     */
    async insertOneAsync(doc) {
        const collection = await new ResourceLocator(this.collectionManager, this._resourceType, this._base_version, this._useAtlas)
            .getOrCreateCollectionForResourceAsync(doc);
        await collection.insertOne(doc);
    }
}

module.exports = {
    DatabaseUpdateManager
};
