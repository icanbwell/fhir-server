const {DatabaseUpdateManager} = require('./databaseUpdateManager');
const assert = require('node:assert/strict');
const {ResourceLocatorFactory} = require('../operations/common/resourceLocatorFactory');

class DatabaseUpdateFactory {
    /**
     * constructor
     * @param {ResourceLocatorFactory} resourceLocatorFactory
     */
    constructor(resourceLocatorFactory) {
        assert(resourceLocatorFactory, 'resourceLocatorFactory is null');
        assert(resourceLocatorFactory instanceof ResourceLocatorFactory,
            `resourceLocatorFactory is of wrong type: ${typeof resourceLocatorFactory}`);
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
