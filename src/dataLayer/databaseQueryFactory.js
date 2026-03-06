const { DatabaseQueryManager } = require('./databaseQueryManager');
const { ResourceLocatorFactory } = require('../operations/common/resourceLocatorFactory');
const { assertTypeEquals, assertIsValid } = require('../utils/assertType');
const { DatabaseAttachmentManager } = require('./databaseAttachmentManager');

class DatabaseQueryFactory {
    /**
     * Constructor
     * @param {ResourceLocatorFactory} resourceLocatorFactory
     * @param {DatabaseAttachmentManager} databaseAttachmentManager
     * @param {import('./providers/storageProviderFactory').StorageProviderFactory} [storageProviderFactory]
     */
    constructor ({ resourceLocatorFactory, databaseAttachmentManager, storageProviderFactory }) {
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

        /**
         * @type {import('./providers/storageProviderFactory').StorageProviderFactory|null}
         */
        this.storageProviderFactory = storageProviderFactory || null;
    }

    /**
     * @param {string} resourceType
     * @param {string} base_version
     * @return {DatabaseQueryManager}
     */
    createQuery ({ resourceType, base_version }) {
        assertIsValid(resourceType, 'resourceType is null');

        // If storage provider factory is available, create storage provider
        let storageProvider = null;
        if (this.storageProviderFactory) {
            storageProvider = this.storageProviderFactory.createProvider({
                resourceType,
                base_version
            });
        }

        return new DatabaseQueryManager(
            {
                resourceLocatorFactory: this.resourceLocatorFactory,
                storageProvider,
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
