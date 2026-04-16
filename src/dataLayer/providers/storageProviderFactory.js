const { MongoStorageProvider } = require('./mongoStorageProvider');
const { MongoWithClickHouseStorageProvider } = require('./mongoWithClickHouseStorageProvider');
const { ClickHouseStorageProvider } = require('./clickHouseStorageProvider');
const { STORAGE_PROVIDER_TYPES } = require('./storageProviderTypes');
const { logInfo, logDebug } = require('../../operations/common/logging');

/**
 * Factory to create appropriate storage provider based on resource type and configuration
 * Implements Factory pattern for provider instantiation
 *
 * Storage Provider Types (defined in storageProviderTypes.js):
 * - MONGO: Pure MongoDB storage (default for most resources)
 * - MONGO_WITH_CLICKHOUSE: MongoDB + ClickHouse (e.g., Group: metadata in Mongo, members in ClickHouse)
 * - CLICKHOUSE: ClickHouse-only storage (future: AuditEvent, append-only logs)
 *
 * Configuration via environment variables:
 * - CLICKHOUSE_ENABLED=true
 * - MONGO_WITH_CLICKHOUSE_RESOURCES=Group (comma-separated list)
 * - CLICKHOUSE_ONLY_RESOURCES=AuditEvent (comma-separated list, not yet implemented)
 */
class StorageProviderFactory {
    /**
     * @param {Object} params
     * @param {import('../../operations/common/resourceLocatorFactory').ResourceLocatorFactory} params.resourceLocatorFactory
     * @param {import('../../utils/clickHouseClientManager').ClickHouseClientManager|null} params.clickHouseClientManager
     * @param {import('../databaseAttachmentManager').DatabaseAttachmentManager} params.databaseAttachmentManager
     * @param {import('../../utils/configManager').ConfigManager} params.configManager
     */
    constructor({
        resourceLocatorFactory,
        clickHouseClientManager,
        databaseAttachmentManager,
        configManager,
        genericClickHouseRepository,
        schemaRegistry
    }) {
        this.resourceLocatorFactory = resourceLocatorFactory;
        this.clickHouseClientManager = clickHouseClientManager;
        this.databaseAttachmentManager = databaseAttachmentManager;
        this.configManager = configManager;
        this.genericClickHouseRepository = genericClickHouseRepository || null;
        this.schemaRegistry = schemaRegistry || null;

        // Log configuration on initialization
        if (this.configManager.enableClickHouse) {
            logInfo('ClickHouse storage enabled', {
                resources: this.configManager.mongoWithClickHouseResources,
                onlyResources: this.configManager.clickHouseOnlyResources
            });
        }
    }

    /**
     * Creates storage provider for given resource type
     * @param {Object} params
     * @param {string} params.resourceType - FHIR resource type (e.g., 'Group', 'Patient')
     * @param {string} params.base_version - FHIR version (e.g., '4_0_0')
     * @returns {import('./storageProvider').StorageProvider}
     */
    createProvider({ resourceType, base_version }) {
        // Create ResourceLocator (needed by all providers)
        const resourceLocator = this.resourceLocatorFactory.createResourceLocator({
            resourceType,
            base_version
        });

        // Determine storage provider type for this resource
        const providerType = this._getStorageProviderType(resourceType);

        logDebug('Creating storage provider', {
            resourceType,
            providerType,
            base_version
        });

        switch (providerType) {
            case STORAGE_PROVIDER_TYPES.MONGO_WITH_CLICKHOUSE: {
                // Create MongoDB provider (needed for dual-write storage)
                const mongoProvider = new MongoStorageProvider({
                    resourceLocator,
                    databaseAttachmentManager: this.databaseAttachmentManager
                });

                return new MongoWithClickHouseStorageProvider({
                    resourceLocator,
                    clickHouseClientManager: this.clickHouseClientManager,
                    mongoStorageProvider: mongoProvider,
                    configManager: this.configManager
                });
            }

            case STORAGE_PROVIDER_TYPES.CLICKHOUSE: {
                return new ClickHouseStorageProvider({
                    resourceLocator,
                    clickHouseClientManager: this.clickHouseClientManager,
                    configManager: this.configManager,
                    genericClickHouseRepository: this.genericClickHouseRepository,
                    resourceType,
                    schemaRegistry: this.schemaRegistry
                });
            }

            case STORAGE_PROVIDER_TYPES.MONGO:
            default: {
                // Default to MongoDB for most resources
                return new MongoStorageProvider({
                    resourceLocator,
                    databaseAttachmentManager: this.databaseAttachmentManager
                });
            }
        }
    }

    /**
     * Determines storage provider type for a resource based on configuration
     *
     * Priority:
     * 1. If ClickHouse disabled → MONGO
     * 2. If in MONGO_WITH_CLICKHOUSE_RESOURCES → MONGO_WITH_CLICKHOUSE
     * 3. If in CLICKHOUSE_ONLY_RESOURCES → CLICKHOUSE
     * 4. Default → MONGO
     *
     * @param {string} resourceType
     * @returns {string} One of STORAGE_PROVIDER_TYPES
     * @private
     */
    _getStorageProviderType(resourceType) {
        // If ClickHouse not enabled, everything goes to MongoDB
        if (!this.configManager.enableClickHouse || !this.clickHouseClientManager) {
            return STORAGE_PROVIDER_TYPES.MONGO;
        }

        // Check MongoDB + ClickHouse resources configuration
        if (this.configManager.mongoWithClickHouseResources.includes(resourceType)) {
            return STORAGE_PROVIDER_TYPES.MONGO_WITH_CLICKHOUSE;
        }

        // Check ClickHouse-only resources configuration
        if (this.configManager.clickHouseOnlyResources.includes(resourceType)) {
            return STORAGE_PROVIDER_TYPES.CLICKHOUSE;
        }

        // Default to MongoDB
        return STORAGE_PROVIDER_TYPES.MONGO;
    }

    /**
     * Gets storage type that would be used for a resource type
     * @param {string} resourceType
     * @returns {string} 'mongo', 'mongo-with-clickhouse', or 'clickhouse'
     */
    getStorageTypeForResource(resourceType) {
        return this._getStorageProviderType(resourceType);
    }

    /**
     * Checks if ClickHouse is available
     * @returns {boolean}
     */
    isClickHouseAvailable() {
        return !!(this.configManager.enableClickHouse && this.clickHouseClientManager);
    }

    /**
     * Gets list of resources using ClickHouse (dual-write or ClickHouse-only)
     * @returns {string[]}
     */
    getClickHouseEnabledResources() {
        return [
            ...this.configManager.mongoWithClickHouseResources,
            ...this.configManager.clickHouseOnlyResources
        ];
    }
}

module.exports = { StorageProviderFactory };
