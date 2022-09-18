const {ResourceLocator} = require('./resourceLocator');
const {MongoCollectionManager} = require('../../utils/mongoCollectionManager');
const {assertTypeEquals} = require('../../utils/assertType');
const {PartitioningManager} = require('../../partitioners/partitioningManager');

/**
 * This factor creates ResourceLocators
 */
class ResourceLocatorFactory {
    /**
     * Constructor
     * @param {MongoCollectionManager} mongoCollectionManager
     * @param {PartitioningManager} partitioningManager
     */
    constructor({mongoCollectionManager, partitioner: partitioningManager}) {
        assertTypeEquals(mongoCollectionManager, MongoCollectionManager);
        /**
         * @type {MongoCollectionManager}
         */
        this.mongoCollectionManager = mongoCollectionManager;
        /**
         * @type {PartitioningManager}
         */
        this.partitioner = partitioningManager;
        assertTypeEquals(partitioningManager, PartitioningManager);
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
                mongoCollectionManager: this.mongoCollectionManager, resourceType, base_version,
                partitioningManager: this.partitioningManager,
                useAtlas
            }
        );
    }
}

module.exports = {
    ResourceLocatorFactory
};
