const {ResourceLocator} = require('./resourceLocator');
const {MongoCollectionManager} = require('../../utils/mongoCollectionManager');
const {assertTypeEquals} = require('../../utils/assertType');
const {Partitioner} = require('../../partitioners/partitioner');

/**
 * This factor creates ResourceLocators
 */
class ResourceLocatorFactory {
    /**
     * Constructor
     * @param {MongoCollectionManager} mongoCollectionManager
     * @param {Partitioner} partitioner
     */
    constructor({mongoCollectionManager, partitioner}) {
        assertTypeEquals(mongoCollectionManager, MongoCollectionManager);
        /**
         * @type {MongoCollectionManager}
         */
        this.mongoCollectionManager = mongoCollectionManager;
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
                mongoCollectionManager: this.mongoCollectionManager, resourceType, base_version,
                partitioner: this.partitioner,
                useAtlas
            }
        );
    }
}

module.exports = {
    ResourceLocatorFactory
};
