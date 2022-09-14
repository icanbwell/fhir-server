const {ResourceLocator} = require('./resourceLocator');
const {MongoCollectionManager} = require('../../utils/mongoCollectionManager');
const {assertTypeEquals} = require('../../utils/assertType');
const {Partitioner} = require('./partitioner');

/**
 * This factor creates ResourceLocators
 */
class ResourceLocatorFactory {
    /**
     * Constructor
     * @param {MongoCollectionManager} collectionManager
     * @param {Partitioner} partitioner
     */
    constructor({collectionManager, partitioner}) {
        assertTypeEquals(collectionManager, MongoCollectionManager);
        /**
         * @type {MongoCollectionManager}
         */
        this.collectionManager = collectionManager;
        /**
         * @type {Partitioner}
         */
        this.partitioner = partitioner;
        assertTypeEquals(partitioner, Partitioner);
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
                collectionManager: this.collectionManager, resourceType, base_version,
                partitioner: this.partitioner,
                useAtlas
            }
        );
    }
}

module.exports = {
    ResourceLocatorFactory
};
