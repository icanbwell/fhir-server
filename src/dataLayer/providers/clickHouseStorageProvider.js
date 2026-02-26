const { StorageProvider } = require('./storageProvider');
const { STORAGE_PROVIDER_TYPES } = require('./storageProviderTypes');

/**
 * Stub for ClickHouse-only resources (e.g., AuditEvent).
 * Append-only, no MongoDB. Implement when first ClickHouse-only resource is added.
 *
 * Architecture:
 * - All data stored in ClickHouse (no MongoDB fallback)
 * - Optimized for append-only operations (audit logs, analytics)
 * - Event-sourced model with time-series optimization
 */
class ClickHouseStorageProvider extends StorageProvider {
    /**
     * @param {Object} params
     * @param {import('../../operations/common/resourceLocator').ResourceLocator} params.resourceLocator
     * @param {import('../../utils/clickHouseClientManager').ClickHouseClientManager} params.clickHouseClientManager
     * @param {import('../../utils/configManager').ConfigManager} params.configManager
     */
    constructor({ resourceLocator, clickHouseClientManager, configManager }) {
        super();
        this.resourceLocator = resourceLocator;
        this.clickHouseClientManager = clickHouseClientManager;
        this.configManager = configManager;
    }

    /**
     * Finds resources - ClickHouse-only query
     * @param {Object} params
     * @param {Object} params.query
     * @param {Object} [params.options]
     * @param {Object} [params.extraInfo]
     * @returns {Promise<import('../databaseCursor').DatabaseCursor>}
     */
    async findAsync({ query, options, extraInfo }) {
        throw new Error('ClickHouseStorageProvider.findAsync not yet implemented');
    }

    /**
     * Finds one resource
     * @param {Object} params
     * @param {Object} params.query
     * @param {Object} [params.options]
     * @returns {Promise<Object|null>}
     */
    async findOneAsync({ query, options }) {
        throw new Error('ClickHouseStorageProvider.findOneAsync not yet implemented');
    }

    /**
     * Counts resources
     * @param {Object} params
     * @param {Object} params.query
     * @returns {Promise<number>}
     */
    async countAsync({ query }) {
        throw new Error('ClickHouseStorageProvider.countAsync not yet implemented');
    }

    /**
     * Inserts/updates resources (ClickHouse-only)
     * @param {Object} params
     * @param {Array<Object>} params.resources
     * @param {Object} [params.options]
     * @returns {Promise<Object>}
     */
    async upsertAsync({ resources, options }) {
        throw new Error('ClickHouseStorageProvider.upsertAsync not yet implemented');
    }

    /**
     * Returns storage type identifier
     * @returns {string}
     */
    getStorageType() {
        return STORAGE_PROVIDER_TYPES.CLICKHOUSE;
    }
}

module.exports = { ClickHouseStorageProvider };
