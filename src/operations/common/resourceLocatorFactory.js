const {ResourceLocator} = require('./resourceLocator');
const {MongoCollectionManager} = require('../../utils/mongoCollectionManager');
const {assertTypeEquals} = require('../../utils/assertType');
const {PartitioningManager} = require('../../partitioners/partitioningManager');
const {MongoDatabaseManager} = require('../../utils/mongoDatabaseManager');

/**
 * This factor creates ResourceLocators
 */
class ResourceLocatorFactory {
    /**
     * Constructor
     * @param {MongoCollectionManager} mongoCollectionManager
     * @param {MongoDatabaseManager} mongoDatabaseManager
     * @param {PartitioningManager} partitioningManager
     */
    constructor({mongoCollectionManager, mongoDatabaseManager, partitioningManager}) {
        assertTypeEquals(mongoCollectionManager, MongoCollectionManager);
        /**
         * @type {MongoCollectionManager}
         */
        this.mongoCollectionManager = mongoCollectionManager;
        /**
         * @type {PartitioningManager}
         */
        this.partitioningManager = partitioningManager;
        assertTypeEquals(partitioningManager, PartitioningManager);

        /**
         * @type {MongoDatabaseManager}
         */
        this.mongoDatabaseManager = mongoDatabaseManager;
        assertTypeEquals(mongoDatabaseManager, MongoDatabaseManager);
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
                useAtlas,
                mongoDatabaseManager: this.mongoDatabaseManager
            }
        );
    }
}

module.exports = {
    ResourceLocatorFactory
};
