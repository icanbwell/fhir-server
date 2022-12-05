const {DatabaseQueryManager} = require('./databaseQueryManager');
const {ResourceLocatorFactory} = require('../operations/common/resourceLocatorFactory');
const {assertTypeEquals} = require('../utils/assertType');

class DatabaseQueryFactory {
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
     * @param {string} resourceType
     * @param {string} base_version
     * @return {DatabaseQueryManager}
     */
    createQuery({resourceType, base_version}) {
        return new DatabaseQueryManager(
            {
                resourceLocatorFactory: this.resourceLocatorFactory,
                resourceType,
                base_version
            }
        );
    }
}

module.exports = {
    DatabaseQueryFactory
};
