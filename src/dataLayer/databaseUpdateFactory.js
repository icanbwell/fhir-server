const {DatabaseUpdateManager} = require('./databaseUpdateManager');
const {ResourceLocatorFactory} = require('../operations/common/resourceLocatorFactory');
const {assertTypeEquals} = require('../utils/assertType');

class DatabaseUpdateFactory {
    /**
     * constructor
     * @param {ResourceLocatorFactory} resourceLocatorFactory
     */
    constructor({resourceLocatorFactory}) {
        assertTypeEquals(resourceLocatorFactory, ResourceLocatorFactory);
        /**
         * @type {ResourceLocatorFactory}
         */
        this.resourceLocatorFactory = resourceLocatorFactory;
    }

    /**
     * create
     * @param {string} resourceType
     * @param {string} base_version
     * @return {DatabaseUpdateManager}
     */
    createDatabaseUpdateManager({resourceType, base_version}) {
        return new DatabaseUpdateManager(
            {
                resourceLocatorFactory: this.resourceLocatorFactory,
                resourceType,
                base_version
            }
        );
    }
}

module.exports = {
    DatabaseUpdateFactory
};
