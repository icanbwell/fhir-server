/**
 * Base interface for storage providers
 * Defines the contract that all storage implementations must follow
 *
 * @interface StorageProvider
 */
class StorageProvider {
    /**
     * Finds resources matching query
     * @param {Object} params
     * @param {Object} params.query - MongoDB-style query object
     * @param {Object} [params.options] - Query options (projection, sort, limit, etc.)
     * @param {Object} [params.extraInfo] - Additional context (operation name, etc.)
     * @returns {Promise<import('../databaseCursor').DatabaseCursor>}
     */
    async findAsync({ query, options, extraInfo }) {
        throw new Error('Not implemented: findAsync must be implemented by subclass');
    }

    /**
     * Finds one resource matching query
     * @param {Object} params
     * @param {Object} params.query - MongoDB-style query object
     * @param {Object} [params.options] - Query options (projection, etc.)
     * @returns {Promise<Object|null>}
     */
    async findOneAsync({ query, options }) {
        throw new Error('Not implemented: findOneAsync must be implemented by subclass');
    }

    /**
     * Inserts or updates resources
     * @param {Object} params
     * @param {Array<Object>} params.resources - Array of FHIR resources to insert/update
     * @param {Object} [params.options] - Operation options
     * @returns {Promise<Object>}
     */
    async upsertAsync({ resources, options }) {
        throw new Error('Not implemented: upsertAsync must be implemented by subclass');
    }

    /**
     * Counts resources matching query
     * @param {Object} params
     * @param {Object} params.query - MongoDB-style query object
     * @returns {Promise<number>}
     */
    async countAsync({ query }) {
        throw new Error('Not implemented: countAsync must be implemented by subclass');
    }

    /**
     * Gets the storage type identifier
     * @returns {string} Storage type (e.g., 'mongodb', 'clickhouse')
     */
    getStorageType() {
        throw new Error('Not implemented: getStorageType must be implemented by subclass');
    }
}

module.exports = { StorageProvider };
