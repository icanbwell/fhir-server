const {ResourceLocator} = require('./resourceLocator');
const {MongoCollectionManager} = require('../../utils/mongoCollectionManager');
const {assertTypeEquals} = require('../../utils/assertType');

/**
 * This factor creates ResourceLocators
 */
class ResourceLocatorFactory {
    /**
     * Constructor
     * @param {MongoCollectionManager} collectionManager
     */
    constructor({collectionManager}) {
        assertTypeEquals(collectionManager, MongoCollectionManager);
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
    createResourceLocator({resourceType, base_version, useAtlas}) {
        return new ResourceLocator(
            {
                collectionManager: this.collectionManager, resourceType, base_version, useAtlas
            }
        );
    }
}

module.exports = {
    ResourceLocatorFactory
};
