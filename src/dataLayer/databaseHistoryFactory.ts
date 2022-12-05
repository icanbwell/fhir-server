const {ResourceLocatorFactory} = require('../operations/common/resourceLocatorFactory');
const {DatabaseHistoryManager} = require('./databaseHistoryManager');
const {assertTypeEquals} = require('../utils/assertType');

class DatabaseHistoryFactory {
    /**
     * Constructor
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
     * Create DatabaseHistoryManager
     * @param {string} resourceType
     * @param {string} base_version
     */
    createDatabaseHistoryManager({resourceType, base_version}) {
        return new DatabaseHistoryManager(
            {
                resourceLocatorFactory: this.resourceLocatorFactory,
                resourceType,
                base_version
            }
        );
    }
}

module.exports = {
    DatabaseHistoryFactory
};
