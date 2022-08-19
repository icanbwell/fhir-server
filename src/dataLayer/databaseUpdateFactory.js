const {DatabaseUpdateManager} = require('./databaseUpdateManager');
const assert = require('node:assert/strict');
const {MongoCollectionManager} = require('../utils/mongoCollectionManager');

class DatabaseUpdateFactory {
    /**
     * constructor
     * @param {ResourceLocatorFactory} resourceLocatorFactory
     */
    constructor(resourceLocatorFactory) {
        assert(resourceLocatorFactory);
        assert(resourceLocatorFactory instanceof MongoCollectionManager);
        /**
         * @type {ResourceLocatorFactory}
         */
        this.resourceLocatorFactory = resourceLocatorFactory;
    }

    /**
     * create
     * @param {string} resourceType
     * @param {string} base_version
     * @param {boolean} useAtlas
     * @return {DatabaseUpdateManager}
     */
    createDatabaseUpdateManager(resourceType, base_version, useAtlas) {
        return new DatabaseUpdateManager(this.resourceLocatorFactory, resourceType, base_version, useAtlas);
    }
}

module.exports = {
    DatabaseUpdateFactory
};
