const {
    ResourceLocator
} = require('../operations/common/resourceLocator');
const {DatabasePartitionedCursor} = require('./databasePartitionedCursor');
const assert = require('node:assert/strict');

/**
 * @typedef FindOneAndUpdateResult
 * @type {object}
 * @property {boolean|null} created
 * @property {Error|null} error
 */

/**
 * @typedef DeleteManyResult
 * @type {object}
 * @property {number|null} deletedCount
 * @property {Error|null} error
 */


/**
 * This class manages access to the database by finding the appropriate partitioned collection to use for the
 * provided resourceType
 */
class DatabaseQueryManager {
    /**
     * Constructor
     * @param {string} resourceType
     * @param {string} base_version
     * @param {boolean} useAtlas
     */
    constructor(resourceType, base_version, useAtlas) {
        assert(resourceType, 'resourceType is not passed to DatabaseQueryManager constructor');
        assert(base_version, 'base_version is not passed to DatabaseQueryManager constructor');
        /**
         * @type {string}
         * @private
         */
        this._resourceType = resourceType;
        /**
         * @type {string}
         * @private
         */
        this._base_version = base_version;
        /**
         * @type {boolean}
         * @private
         */
        this._useAtlas = useAtlas;
    }

    /**
     * Finds one resource by looking in multiple partitions of a resource type
     * @param {import('mongodb').FilterQuery<import('mongodb').DefaultSchema>} filter
     * @param {import('mongodb').WithoutProjection<FindOneOptions<import('mongodb').DefaultSchema>> | null} options
     * @return {Promise<Resource|any>}
     */
    async findOneAsync(filter, options = null) {
        /**
         * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>[]}
         */
        const collections = await new ResourceLocator(this._resourceType, this._base_version, this._useAtlas)
            .getOrCreateCollectionsForQueryAsync();
        for (const /** @type import('mongodb').Collection<import('mongodb').DefaultSchema> */ collection of collections) {
            /**
             * @type { Promise<Resource|null>}
             */
            const resource = await collection.findOne(filter, options);
            if (resource !== null) {
                return resource;
            }
        }
        return null;
    }

    /**
     * Finds one resource by looking in multiple partitions of a resource type
     * @param {import('mongodb').FilterQuery<import('mongodb').DefaultSchema>} filter
     * @param {import('mongodb').UpdateQuery<import('mongodb').DefaultSchema> | any} update
     * @param {import('mongodb').FindOneAndUpdateOption<import('mongodb').DefaultSchema> | null} options
     * @return {Promise<FindOneAndUpdateResult | null>}
     */
    async findOneAndUpdateAsync(filter, update, options = null) {
        /**
         * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>[]}
         */
        const collections = await new ResourceLocator(this._resourceType, this._base_version, this._useAtlas)
            .getOrCreateCollectionsForQueryAsync();
        for (const /** @type import('mongodb').Collection<import('mongodb').DefaultSchema> */ collection of collections) {
            /**
             * @type {FindAndModifyWriteOpResultObject<import('mongodb').DefaultSchema>}
             */
            const result = await collection.findOneAndUpdate(filter, update, options);
            if (result.ok) {
                return {
                    error: result.lastErrorObject,
                    created: result.lastErrorObject && !result.lastErrorObject.updatedExisting
                };
            }
        }
        return null;
    }

    /**
     * Finds one resource by looking in multiple partitions of a resource type
     * @param {import('mongodb').FilterQuery<import('mongodb').DefaultSchema>} filter
     * @param {import('mongodb').CommonOptions | null} options
     * @return {Promise<DeleteManyResult>}
     */
    async deleteManyAsync(filter, options = null) {
        /**
         * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>[]}
         */
        const collections = await new ResourceLocator(this._resourceType, this._base_version, this._useAtlas)
            .getOrCreateCollectionsForQueryAsync();
        let deletedCount = 0;
        for (const /** @type import('mongodb').Collection<import('mongodb').DefaultSchema> */ collection of collections) {
            /**
             * @type {import('mongodb').DeleteWriteOpResultObject}
             */
            const result = await collection.deleteMany(filter, options);
            deletedCount += result.deletedCount;

        }
        return {deletedCount: deletedCount, error: null};
    }

    /**
     * Returns a DatabasePartitionedCursor by executing the query
     * @param {import('mongodb').FilterQuery<import('mongodb').DefaultSchema>} filter
     * @param {import('mongodb').WithoutProjection<import('mongodb').FindOptions<import('mongodb').DefaultSchema>> | null} options
     * @return {DatabasePartitionedCursor}
     */
    async findAsync(filter, options = null) {
        /**
         * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>[]}
         */
        const collections = await new ResourceLocator(this._resourceType, this._base_version, this._useAtlas)
            .getOrCreateCollectionsForQueryAsync();
        /**
         * @type {import('mongodb').Cursor<import('mongodb').DefaultSchema>[]}
         */
        const cursors = [];
        for (const /** @type import('mongodb').Collection<import('mongodb').DefaultSchema> */ collection of collections) {
            /**
             * @type {import('mongodb').Cursor<import('mongodb').DefaultSchema>}
             */
            const cursor = collection.find(filter, options);
            cursors.push(cursor);
        }
        return new DatabasePartitionedCursor(cursors);
    }

    /**
     * Gets estimated count
     * @param {import('mongodb').FilterQuery<import('mongodb').DefaultSchema>|null} filter
     * @param { import('mongodb').MongoCountPreferences|null} options
     * @return {Promise<*>}
     */
    async estimatedDocumentCountAsync(filter, options) {
        /**
         * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>[]}
         */
        const collections = await new ResourceLocator(this._resourceType, this._base_version, this._useAtlas)
            .getOrCreateCollectionsForQueryAsync();
        let count = 0;
        for (const /** @type import('mongodb').Collection<import('mongodb').DefaultSchema> */ collection of collections) {
            /**
             * @type {number}
             */
            const countInCollection = await collection.estimatedDocumentCount(filter, options);
            count += countInCollection;
        }
        return count;
    }

    /**
     * Gets exact count
     * @param {import('mongodb').FilterQuery<import('mongodb').DefaultSchema>|null} filter
     * @param { import('mongodb').MongoCountPreferences|null} options
     * @return {Promise<*>}
     */
    async exactDocumentCountAsync(filter, options) {
        /**
         * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>[]}
         */
        const collections = await new ResourceLocator(this._resourceType, this._base_version, this._useAtlas)
            .getOrCreateCollectionsForQueryAsync();
        let count = 0;
        for (const /** @type import('mongodb').Collection<import('mongodb').DefaultSchema> */ collection of collections) {
            /**
             * @type {number}
             */
            const countInCollection = await collection.countDocuments(filter, options);
            count += countInCollection;
        }
        return count;
    }
}

module.exports = {
    DatabaseQueryManager
};
