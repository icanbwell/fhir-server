const { DatabaseQueryManager } = require('./databaseQueryManager');
const { ResourceLocatorFactory } = require('../operations/common/resourceLocatorFactory');
const { assertTypeEquals, assertIsValid } = require('../utils/assertType');

class DatabaseQueryFactory {
    /**
     * Constructor
     * @param {ResourceLocatorFactory} resourceLocatorFactory
     * @param {import('./providers/storageProviderFactory').StorageProviderFactory} [storageProviderFactory]
     */
    constructor ({ resourceLocatorFactory, storageProviderFactory }) {
        assertTypeEquals(resourceLocatorFactory, ResourceLocatorFactory);
        /**
         * @type {ResourceLocatorFactory}
         */
        this.resourceLocatorFactory = resourceLocatorFactory;

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
                base_version
            }
        );
    }
}

module.exports = {
    DatabaseQueryFactory
};
