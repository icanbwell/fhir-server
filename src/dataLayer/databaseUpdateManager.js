/**
 * This class manages inserts and updates to the database
 */
const {assertTypeEquals} = require('../utils/assertType');
const {ResourceLocatorFactory} = require('../operations/common/resourceLocatorFactory');
const {RethrownError} = require('../utils/rethrownError');

class DatabaseUpdateManager {
    /**
     * Constructor
     * @param {ResourceLocatorFactory} resourceLocatorFactory
     * @param {string} resourceType
     * @param {string} base_version
     * @param {boolean} useAtlas
     */
    constructor({resourceLocatorFactory, resourceType, base_version, useAtlas}) {
        assertTypeEquals(resourceLocatorFactory, ResourceLocatorFactory);
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
        this.resourceLocator = resourceLocatorFactory.createResourceLocator(
            {
                resourceType: this._resourceType,
                base_version: this._base_version,
                useAtlas: this._useAtlas
            });
    }

    /**
     * Inserts a resource into the database
     * @param {Resource} doc
     * @return {Promise<void>}
     */
    async insertOneAsync({doc}) {
        try {
            const collection = await this.resourceLocator.getOrCreateCollectionForResourceAsync(doc);
            await collection.insertOne(doc.toJSONInternal());
        } catch (e) {
            throw new RethrownError({
                error: e
            });
        }
    }
}

module.exports = {
    DatabaseUpdateManager
};
