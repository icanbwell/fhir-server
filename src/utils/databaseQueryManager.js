const {
    getOrCreateCollectionsForQueryForResourceTypeAsync
} = require('../operations/common/resourceManager');
const {DatabasePartitionedCursor} = require('./databasePartitionedCursor');

class DatabaseQueryManager {
    /**
     *
     * @param {string} resourceType
     * @param {string} base_version
     * @param {boolean} useAtlas
     */
    constructor(resourceType, base_version, useAtlas) {
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
     * @param { WithoutProjection<FindOneOptions<import('mongodb').DefaultSchema>> | null} options
     * @return {Promise<Resource|any>}
     */
    async findOneAsync(filter, options = null) {
        /**
         * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>[]}
         */
        const collections = await getOrCreateCollectionsForQueryForResourceTypeAsync(
            this._resourceType, this._base_version, this._useAtlas);
        for (const /** @type import('mongodb').Collection<import('mongodb').DefaultSchema> */ collection in collections) {
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
     * @return {Promise<Resource|any>}
     */
    async findOneAndUpdateAsync(filter, update, options = null) {
        /**
         * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>[]}
         */
        const collections = await getOrCreateCollectionsForQueryForResourceTypeAsync(
            this._resourceType, this._base_version, this._useAtlas);
        for (const /** @type import('mongodb').Collection<import('mongodb').DefaultSchema> */ collection in collections) {
            await collection.findOneAndUpdate(filter, update, options);
        }
        return null;
    }

    /**
     * Finds one resource by looking in multiple partitions of a resource type
     * @param {import('mongodb').FilterQuery<import('mongodb').DefaultSchema>} filter
     * @param {import('mongodb').CommonOptions | null} options
     * @return {Promise<void>}
     */
    async deleteManyAsync(filter, options = null) {
        /**
         * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>[]}
         */
        const collections = await getOrCreateCollectionsForQueryForResourceTypeAsync(
            this._resourceType, this._base_version, this._useAtlas);
        for (const /** @type import('mongodb').Collection<import('mongodb').DefaultSchema> */ collection in collections) {
            await collection.deleteMany(filter, options);
        }
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
        const collections = await getOrCreateCollectionsForQueryForResourceTypeAsync(
            this._resourceType, this._base_version, this._useAtlas);
        /**
         * @type {import('mongodb').Cursor<import('mongodb').DefaultSchema>[]}
         */
        const cursors = [];
        for (const /** @type import('mongodb').Collection<import('mongodb').DefaultSchema> */ collection in collections) {
            /**
             * @type {import('mongodb').Cursor<import('mongodb').DefaultSchema>}
             */
            const cursor = await collection.find(filter, options);
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
        const collections = await getOrCreateCollectionsForQueryForResourceTypeAsync(
            this._resourceType, this._base_version, this._useAtlas);
        let count = 0;
        for (const /** @type import('mongodb').Collection<import('mongodb').DefaultSchema> */ collection in collections) {
            /**
             * @type {number}
             */
            const countInCollection = await collection.estimatedDocumentCount(filter, options);
            count += countInCollection;
        }
        return count;
    }

    /**
     * Gets estimated count
     * @param {import('mongodb').FilterQuery<import('mongodb').DefaultSchema>|null} filter
     * @param { import('mongodb').MongoCountPreferences|null} options
     * @return {Promise<*>}
     */
    async exactDocumentCountAsync(filter, options) {
        /**
         * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>[]}
         */
        const collections = await getOrCreateCollectionsForQueryForResourceTypeAsync(
            this._resourceType, this._base_version, this._useAtlas);
        let count = 0;
        for (const /** @type import('mongodb').Collection<import('mongodb').DefaultSchema> */ collection in collections) {
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
