const { StorageProvider } = require('./storageProvider');
const { DatabaseCursor } = require('../databaseCursor');
const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');
const { STORAGE_PROVIDER_TYPES } = require('./storageProviderTypes');

/**
 * MongoDB implementation of storage provider
 * Wraps existing MongoDB logic without changing behavior
 */
class MongoStorageProvider extends StorageProvider {
    /**
     * @param {Object} params
     * @param {import('../../operations/common/resourceLocator').ResourceLocator} params.resourceLocator
     * @param {import('../databaseAttachmentManager').DatabaseAttachmentManager} params.databaseAttachmentManager
     */
    constructor({ resourceLocator, databaseAttachmentManager }) {
        super();
        /**
         * @type {import('../../operations/common/resourceLocator').ResourceLocator}
         * @private
         */
        this.resourceLocator = resourceLocator;

        /**
         * @type {import('../databaseAttachmentManager').DatabaseAttachmentManager}
         * @private
         */
        this.databaseAttachmentManager = databaseAttachmentManager;
    }

    /**
     * Finds resources matching query using MongoDB
     * @param {Object} params
     * @param {Object} params.query
     * @param {Object} [params.options]
     * @param {Object} [params.extraInfo]
     * @returns {Promise<import('../databaseCursor').DatabaseCursor>}
     */
    async findAsync({ query, options, extraInfo }) {
        // Delegate to existing MongoDB logic through ResourceLocator
        const collection = await this.resourceLocator.getCollectionAsync({ extraInfo });

        // Create MongoDB cursor
        const cursor = collection.find(query, options);

        // Return standard DatabaseCursor
        return new DatabaseCursor({
            cursor,
            query,
            resourceType: this.resourceLocator._resourceType,
            base_version: this.resourceLocator._base_version
        });
    }

    /**
     * Finds one resource matching query using MongoDB
     * @param {Object} params
     * @param {Object} params.query
     * @param {Object} [params.options]
     * @returns {Promise<Object|null>}
     */
    async findOneAsync({ query, options }) {
        const collection = await this.resourceLocator.getCollectionAsync({});

        const resource = await collection.findOne(query, options);

        if (resource !== null) {
            // Convert to FHIR resource object
            return FhirResourceCreator.createByResourceType(
                resource,
                this.resourceLocator._resourceType
            );
        }

        return null;
    }

    /**
     * Inserts or updates resources in MongoDB
     * NOTE: This is a simplified version. Actual upsert logic is handled
     * by DatabaseBulkInserter and DatabaseUpdateManager
     * @param {Object} params
     * @param {Array<Object>} params.resources
     * @param {Object} [params.options]
     * @returns {Promise<Object>}
     */
    async upsertAsync({ resources, options }) {
        // This method is primarily called from ClickHouseStorageProvider
        // for dual-write scenarios. The actual MongoDB insert/update logic
        // remains in DatabaseBulkInserter and DatabaseUpdateManager.
        //
        // For MongoDB-only scenarios, those managers are used directly.
        return { acknowledged: true, insertedCount: resources.length };
    }

    /**
     * Counts resources matching query in MongoDB
     * @param {Object} params
     * @param {Object} params.query
     * @returns {Promise<number>}
     */
    async countAsync({ query }) {
        const collection = await this.resourceLocator.getCollectionAsync({});
        return await collection.countDocuments(query);
    }

    /**
     * Returns storage type identifier
     * @returns {string}
     */
    getStorageType() {
        return STORAGE_PROVIDER_TYPES.MONGO;
    }

    /**
     * Gets the underlying MongoDB collection
     * @param {Object} [extraInfo]
     * @returns {Promise<import('mongodb').Collection>}
     */
    async getCollectionAsync(extraInfo = {}) {
        return await this.resourceLocator.getCollectionAsync(extraInfo);
    }

    /**
     * Gets the ResourceLocator (for backward compatibility)
     * @returns {import('../../operations/common/resourceLocator').ResourceLocator}
     */
    getResourceLocator() {
        return this.resourceLocator;
    }
}

module.exports = { MongoStorageProvider };
