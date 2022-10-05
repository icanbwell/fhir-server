const {DatabasePartitionedCursor} = require('./databasePartitionedCursor');
const {ResourceLocatorFactory} = require('../operations/common/resourceLocatorFactory');
const {ResourceLocator} = require('../operations/common/resourceLocator');
const {assertTypeEquals} = require('../utils/assertType');
const {getResource} = require('../operations/common/getResource');

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
     * @param {ResourceLocatorFactory} resourceLocatorFactory
     * @param {string} resourceType
     * @param {string} base_version
     * @param {boolean} useAtlas
     */
    constructor({resourceLocatorFactory, resourceType, base_version, useAtlas}) {
        assertTypeEquals(resourceLocatorFactory, ResourceLocatorFactory);
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
        /**
         * @type {ResourceLocator}
         */
        this.resourceLocator = resourceLocatorFactory.createResourceLocator({
            resourceType: this._resourceType,
            base_version: this._base_version,
            useAtlas: this._useAtlas
        });
        assertTypeEquals(this.resourceLocator, ResourceLocator);
    }

    /**
     * Finds one resource by looking in multiple partitions of a resource type
     * @param {import('mongodb').Filter<import('mongodb').DefaultSchema>} query
     * @param {import('mongodb').FindOptions<import('mongodb').DefaultSchema>} options
     * @return {Promise<Resource|any>}
     */
    async findOneAsync({query, options = null}) {
        /**
         * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>[]}
         */
        const collections = await this.resourceLocator.getOrCreateCollectionsForQueryAsync({
            query
        });
        for (const /** @type import('mongodb').Collection<import('mongodb').DefaultSchema> */ collection of collections) {
            /**
             * @type { Promise<Resource|null>}
             */
            const resource = await collection.findOne(query, options);
            if (resource !== null) {
                const ResourceCreator = getResource(this._base_version, this._resourceType);
                return new ResourceCreator(resource);
            }
        }
        return null;
    }

    /**
     * Finds one resource by looking in multiple partitions of a resource type
     * @param {import('mongodb').Filter<import('mongodb').DefaultSchema>} query
     * @param {import('mongodb').UpdateFilter<import('mongodb').DefaultSchema> | any} update
     * @param {import('mongodb').FindOneAndUpdateOptions<import('mongodb').DefaultSchema>} options
     * @return {Promise<{error: import('mongodb').Document, created: boolean} | null>}
     */
    async findOneAndUpdateAsync({query, update, options = null}) {
        /**
         * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>[]}
         */
        const collections = await this.resourceLocator.getOrCreateCollectionsForQueryAsync({
            query
        });
        for (const /** @type import('mongodb').Collection<import('mongodb').DefaultSchema> */ collection of collections) {
            /**
             * https://mongodb.github.io/node-mongodb-native/4.9/classes/Collection.html#findOneAndUpdate
             * @type {ModifyResult<import('mongodb').DefaultSchema>}
             */
            const result = await collection.findOneAndUpdate(query, update, options);
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
     * @param {import('mongodb').Filter<import('mongodb').DefaultSchema>} query
     * @param {import('mongodb').DeleteOptions} options
     * @return {Promise<DeleteManyResult>}
     */
    async deleteManyAsync({query, options = {}}) {
        /**
         * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>[]}
         */
        const collections = await this.resourceLocator.getOrCreateCollectionsForQueryAsync({
            query
        });
        let deletedCount = 0;
        for (const /** @type import('mongodb').Collection<import('mongodb').DefaultSchema> */ collection of collections) {
            /**
             * @type {import('mongodb').DeleteWriteOpResultObject}
             */
            const result = await collection.deleteMany(query, options);
            deletedCount += result.deletedCount;

        }
        return {deletedCount: deletedCount, error: null};
    }

    /**
     * Returns a DatabasePartitionedCursor by executing the query
     * @param {import('mongodb').Filter<import('mongodb').DefaultSchema>} query
     * @param {import('mongodb').FindOptions<import('mongodb').DefaultSchema>} options
     * @return {DatabasePartitionedCursor}
     */
    async findAsync({query, options = null}) {
        /**
         * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>[]}
         */
        const collections = await this.resourceLocator.getOrCreateCollectionsForQueryAsync({query});
        /**
         * @type {import('mongodb').FindCursor<import('mongodb').WithId<import('mongodb').DefaultSchema>>[]}
         */
        const cursors = [];
        for (const /** @type import('mongodb').Collection<import('mongodb').DefaultSchema> */ collection of collections) {
            /**
             * @type {import('mongodb').FindCursor<import('mongodb').WithId<import('mongodb').DefaultSchema>>}
             */
            const cursor = collection.find(query, options);
            cursors.push(cursor);
        }
        return new DatabasePartitionedCursor({
            base_version: this._base_version, resourceType: this._resourceType, cursors,
            query
        });
    }

    /**
     * Gets estimated count of ALL documents in a collection.  This does not accept a query
     * @param {import('mongodb').EstimatedDocumentCountOptions} options
     * @return {Promise<*>}
     */
    async estimatedDocumentCountAsync({options}) {
        /**
         * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>[]}
         */
        const collections = await this.resourceLocator.getOrCreateCollectionsForQueryAsync({
            query: undefined
        });
        let count = 0;
        for (const /** @type import('mongodb').Collection<import('mongodb').DefaultSchema> */ collection of collections) {
            /**
             * https://mongodb.github.io/node-mongodb-native/4.9/classes/Collection.html#estimatedDocumentCount
             * @type {number}
             */
            const countInCollection = await collection.estimatedDocumentCount(options);
            count += countInCollection;
        }
        return count;
    }

    /**
     * Gets exact count
     * @param {import('mongodb').FilterQuery<import('mongodb').DefaultSchema>|null} query
     * @param { import('mongodb').MongoCountPreferences|null} options
     * @return {Promise<*>}
     */
    async exactDocumentCountAsync({query, options}) {
        /**
         * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>[]}
         */
        const collections = await this.resourceLocator.getOrCreateCollectionsForQueryAsync({
            query: undefined
        });
        let count = 0;
        for (const /** @type import('mongodb').Collection<import('mongodb').DefaultSchema> */ collection of collections) {
            /**
             * @type {number}
             */
            const countInCollection = await collection.countDocuments(query, options);
            count += countInCollection;
        }
        return count;
    }
}

module.exports = {
    DatabaseQueryManager
};
