const {
    getOrCreateCollectionForResourceTypeAsync,
    getOrCreateCollectionsForQueryForResourceTypeAsync
} = require('../operations/common/resourceManager');
const {DatabasePartitionedCursor} = require('./databasePartitionedCursor');

class DatabaseHistoryManager {
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
     * @param {Resource} doc
     * @return {Promise<void>}
     */
    async insertOne(doc) {
        const collection = await getOrCreateCollectionForResourceTypeAsync(this._resourceType, this._base_version, this._useAtlas, doc);
        await collection.insertOne(doc);
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
}

module.exports = {
    DatabaseHistoryManager
};
