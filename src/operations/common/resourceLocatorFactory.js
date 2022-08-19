const {ResourceLocator} = require('./resourceLocator');
const assert = require('node:assert/strict');
const {MongoCollectionManager} = require('../../utils/mongoCollectionManager');

/**
 * This factor creates ResourceLocators
 */
class ResourceLocatorFactory {
    /**
     * Constructor
     * @param {MongoCollectionManager} collectionManager
     */
    constructor(collectionManager) {
        assert(collectionManager);
        assert(collectionManager instanceof MongoCollectionManager);
        /**
         * @type {MongoCollectionManager}
         */
        this.collectionManager = collectionManager;
    }

    /**
     * @param {string} resourceType
     * @param {string} base_version
     * @param {boolean|null} useAtlas
     * @return {ResourceLocator}
     */
    createResourceLocator(resourceType, base_version, useAtlas) {
        return new ResourceLocator(this.collectionManager, resourceType, base_version, useAtlas);
    }
}

module.exports = {
    ResourceLocatorFactory
};
