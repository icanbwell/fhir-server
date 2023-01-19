const {DatabaseQueryManager} = require('./databaseQueryManager');
const {ResourceLocatorFactory} = require('../operations/common/resourceLocatorFactory');
const {assertTypeEquals} = require('../utils/assertType');
const {MongoFilterGenerator} = require('../utils/mongoFilterGenerator');

class DatabaseQueryFactory {
    /**
     * Constructor
     * @param {ResourceLocatorFactory} resourceLocatorFactory
     * @param {MongoFilterGenerator} mongoFilterGenerator
     */
    constructor({resourceLocatorFactory, mongoFilterGenerator}) {
        assertTypeEquals(resourceLocatorFactory, ResourceLocatorFactory);
        /**
         * @type {ResourceLocatorFactory}
         */
        this.resourceLocatorFactory = resourceLocatorFactory;

        /**
         * @type {MongoFilterGenerator}
         */
        this.mongoFilterGenerator = mongoFilterGenerator;
        assertTypeEquals(mongoFilterGenerator, MongoFilterGenerator);

    }

    /**
     * @param {string} resourceType
     * @param {string} base_version
     * @return {DatabaseQueryManager}
     */
    createQuery({resourceType, base_version}) {
        return new DatabaseQueryManager(
            {
                resourceLocatorFactory: this.resourceLocatorFactory,
                resourceType,
                base_version,
                mongoFilterGenerator: this.mongoFilterGenerator
            }
        );
    }
}

module.exports = {
    DatabaseQueryFactory
};
