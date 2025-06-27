const { DatabaseQueryManager } = require('./databaseQueryManager');
const { ResourceLocatorFactory } = require('../operations/common/resourceLocatorFactory');
const { assertTypeEquals, assertIsValid } = require('../utils/assertType');
const { DatabaseAttachmentManager } = require('./databaseAttachmentManager');

class DatabaseQueryFactory {
    /**
     * Constructor
     * @param {ResourceLocatorFactory} resourceLocatorFactory
     * @param {DatabaseAttachmentManager} databaseAttachmentManager
     */
    constructor ({ resourceLocatorFactory, databaseAttachmentManager }) {
        assertTypeEquals(resourceLocatorFactory, ResourceLocatorFactory);
        /**
         * @type {ResourceLocatorFactory}
         */
        this.resourceLocatorFactory = resourceLocatorFactory;

        /**
         * @type {DatabaseAttachmentManager}
         */
        this.databaseAttachmentManager = databaseAttachmentManager;
        assertTypeEquals(databaseAttachmentManager, DatabaseAttachmentManager);
    }

    /**
     * @param {string} resourceType
     * @param {string} base_version
     * @return {DatabaseQueryManager}
     */
    createQuery ({ resourceType, base_version }) {
        assertIsValid(resourceType, 'resourceType is null');
        return new DatabaseQueryManager(
            {
                resourceLocatorFactory: this.resourceLocatorFactory,
                resourceType,
                base_version,
                databaseAttachmentManager: this.databaseAttachmentManager
            }
        );
    }
}

module.exports = {
    DatabaseQueryFactory
};
