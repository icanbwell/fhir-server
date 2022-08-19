const assert = require('node:assert/strict');
const {DatabaseQueryManager} = require('./databaseQueryManager');

class DatabaseQueryFactory {
    /**
     * Constructor
     * @param {ResourceLocatorFactory} resourceLocatorFactory
     */
    constructor(resourceLocatorFactory) {
        assert(resourceLocatorFactory);
        /**
         * @type {ResourceLocatorFactory}
         */
        this.resourceLocatorFactory = resourceLocatorFactory;
    }

    /**
     * @param {string} resourceType
     * @param {string} base_version
     * @param {boolean} useAtlas
     * @return {DatabaseQueryManager}
     */
    createQuery(resourceType, base_version, useAtlas) {
        return new DatabaseQueryManager(
            this.resourceLocatorFactory, resourceType, base_version, useAtlas
        );
    }
}

module.exports = {
    DatabaseQueryFactory
};
