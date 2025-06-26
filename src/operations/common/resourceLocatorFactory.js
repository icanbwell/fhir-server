const { ResourceLocator } = require('./resourceLocator');
const { assertTypeEquals, assertIsValid } = require('../../utils/assertType');
const { MongoDatabaseManager } = require('../../utils/mongoDatabaseManager');

/**
 * This factor creates ResourceLocators
 */
class ResourceLocatorFactory {
    /**
     * Constructor
     * @param {MongoDatabaseManager} mongoDatabaseManager
     */
    constructor({ mongoDatabaseManager }) {
        /**
         * @type {MongoDatabaseManager}
         */
        this.mongoDatabaseManager = mongoDatabaseManager;
        assertTypeEquals(mongoDatabaseManager, MongoDatabaseManager);
    }

    /**
     * @param {string} resourceType
     * @param {string} base_version
     * @return {ResourceLocator}
     */
    createResourceLocator({ resourceType, base_version }) {
        assertIsValid(resourceType, 'resourceType is missing');
        assertIsValid(base_version, 'base_version is missing');
        return new ResourceLocator({
            resourceType,
            base_version,
            mongoDatabaseManager: this.mongoDatabaseManager
        });
    }
}

module.exports = {
    ResourceLocatorFactory
};
