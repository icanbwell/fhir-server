const async = require('async');
const {assertIsValid, assertTypeEquals} = require('../../utils/assertType');
const {MongoCollectionManager} = require('../../utils/mongoCollectionManager');
const {PartitioningManager} = require('../../partitioners/partitioningManager');
const {MongoDatabaseManager} = require('../../utils/mongoDatabaseManager');

/**
 * This class returns collections that contain the requested resourceType
 */
class ResourceLocator {
    /**
     * @param {MongoDatabaseManager} mongoDatabaseManager
     * @param {MongoCollectionManager} mongoCollectionManager
     * @param {string} resourceType
     * @param {string} base_version
     * @param {PartitioningManager} partitioningManager
     */
    constructor({
                    mongoDatabaseManager,
                    mongoCollectionManager, resourceType, base_version, partitioningManager
                }) {
        assertIsValid(resourceType, 'resourceType is not passed to ResourceLocator constructor');
        assertIsValid(base_version, 'base_version is not passed to ResourceLocator constructor');
        assertTypeEquals(mongoCollectionManager, MongoCollectionManager);
        /**
         * @type {MongoCollectionManager}
         */
        this.mongoCollectionManager = mongoCollectionManager;
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
         * @type {PartitioningManager}
         */
        this.partitioningManager = partitioningManager;
        assertTypeEquals(partitioningManager, PartitioningManager);

        /**
         * @type {MongoDatabaseManager}
         */
        this.mongoDatabaseManager = mongoDatabaseManager;
        assertTypeEquals(mongoDatabaseManager, MongoDatabaseManager);

    }

    /**
     * returns the collection name for this resource
     * @param {Resource} resource
     * @returns {string}
     */
    async getCollectionNameAsync(resource) {
        assertIsValid(!this._resourceType.endsWith('4_0_0'), `resourceType ${this._resourceType} has an invalid postfix`);
        const partition = await this.partitioningManager.getPartitionNameByResourceAsync(
            {resource, base_version: this._base_version});
        return partition;
    }

    /**
     * returns unique collections names for the provided resources
     * @param {Resource[]} resources
     * @returns {string[]}
     */
    async getCollectionNamesAsync({resources}) {
        assertIsValid(!this._resourceType.endsWith('4_0_0'), `resourceType ${this._resourceType} has an invalid postfix`);
        const partitions = await async.map(
            resources,
            async (resource) => await this.partitioningManager.getPartitionNameByResourceAsync(
                {resource, base_version: this._base_version})
        );
        return Array.from(new Set(partitions));
    }

    /**
     * returns all the collection names for resourceType
     * @param {import('mongodb').Filter<import('mongodb').DefaultSchema>} query
     * @returns {string[]}
     */
    async getCollectionNamesForQueryAsync({query}) {
        assertIsValid(!this._resourceType.endsWith('4_0_0'), `resourceType ${this._resourceType} has an invalid postfix`);
        return await this.partitioningManager.getPartitionNamesByQueryAsync({
            resourceType: this._resourceType,
            base_version: this._base_version,
            query
        });
    }

    /**
     * returns the first collection name for resourceType.   Use for debugging only
     * @param {import('mongodb').Filter<import('mongodb').DefaultSchema>} [query]
     * @returns {string}
     */
    async getFirstCollectionNameForQueryDebugOnlyAsync({query}) {
        assertIsValid(!this._resourceType.endsWith('4_0_0'), `resourceType ${this._resourceType} has an invalid postfix`);
        /**
         * @type {string[]}
         */
        const collectionNames = await this.partitioningManager.getPartitionNamesByQueryAsync({
            resourceType: this._resourceType,
            base_version: this._base_version,
            query
        });
        return collectionNames.length > 0 ? collectionNames[0] : '';
    }

    /**
     * returns the history collection name for the given resource
     * @param {Resource} resource
     * @returns {string}
     */
    async getHistoryCollectionNameAsync(resource) {
        assertIsValid(!this._resourceType.endsWith('_History'), `resourceType ${this._resourceType} has an invalid postfix`);
        /**
         * @type {string}
         */
        const partition = await this.partitioningManager.getPartitionNameByResourceAsync({
            resource,
            base_version: this._base_version
        });
        return `${partition}_History`;
    }

    /**
     * returns all the collection names for resourceType
     * @param {import('mongodb').Filter<import('mongodb').DefaultSchema>} [query]
     * @returns {string[]}
     */
    async getHistoryCollectionNamesForQueryAsync({query}) {
        assertIsValid(!this._resourceType.endsWith('_History'), `resourceType ${this._resourceType} has an invalid postfix`);
        return await this.partitioningManager.getAllHistoryPartitionsForResourceTypeAsync({
            resourceType: this._resourceType,
            base_version: this._base_version,
            query
        });
    }

    /**
     * Gets the database connection for the given collection
     * @returns {import('mongodb').Db}
     */
    async getDatabaseConnectionAsync() {
        // noinspection JSValidateTypes
        return this.mongoDatabaseManager.getDatabaseForResource(
            {
                resourceType: this._resourceType
            });
    }

    /**
     * Creates a db collection for given collection name
     * @param {string} collectionName
     * @return {Promise<import('mongodb').Collection<import('mongodb').DefaultSchema>>}
     */
    async getOrCreateCollectionAsync(collectionName) {
        /**
         * mongo db connection
         * @type {import('mongodb').Db}
         */
        const db = await this.getDatabaseConnectionAsync();
        return await this.mongoCollectionManager.getOrCreateCollectionAsync(
            {db, collectionName});
    }

    /**
     * Gets the collection for this resource.  If collection does not exist then it is created
     * @param {Resource} resource
     * @return {Promise<import('mongodb').Collection<import('mongodb').DefaultSchema>>}
     */
    async getOrCreateCollectionForResourceAsync(resource) {
        /**
         * @type {string}
         */
        const collectionName = await this.getCollectionNameAsync(resource);
        return await this.getOrCreateCollectionAsync(collectionName);
    }

    /**
     * Gets all the collections for these resources.  If collections do not exist then they are created.
     * @param {Resource[]} resources
     * @return {Promise<import('mongodb').Collection<import('mongodb').DefaultSchema>[]>}
     */
    async getOrCreateCollectionsAsync({resources}) {
        /**
         * @type {string[]}
         */
        const collectionNames = await this.getCollectionNamesAsync({resources});
        /**
         * mongo db connection
         * @type {import('mongodb').Db}
         */
        const db = await this.getDatabaseConnectionAsync();
        return async.map(collectionNames,
            async collectionName => await this.mongoCollectionManager.getOrCreateCollectionAsync(
                {db, collectionName}));
    }

    /**
     * Gets all the collections for this resourceType.  If collections do not exist then they are created.
     * @param {import('mongodb').Filter<import('mongodb').DefaultSchema>} query
     * @return {Promise<import('mongodb').Collection<import('mongodb').DefaultSchema>[]>}
     */
    async getOrCreateCollectionsForQueryAsync({query}) {
        /**
         * @type {string[]}
         */
        const collectionNames = await this.getCollectionNamesForQueryAsync({query});
        /**
         * mongo db connection
         * @type {import('mongodb').Db}
         */
        const db = await this.getDatabaseConnectionAsync();
        return async.map(collectionNames,
            async collectionName => await this.mongoCollectionManager.getOrCreateCollectionAsync(
                {db, collectionName}));
    }

    /**
     * Gets all the collections for this resourceType.  If collections do not exist then they are created.
     * @param {import('mongodb').Filter<import('mongodb').DefaultSchema>} [query]
     * @return {Promise<import('mongodb').Collection<import('mongodb').DefaultSchema>[]>}
     */
    async getOrCreateHistoryCollectionsForQueryAsync({query}) {
        /**
         * @type {string[]}
         */
        const collectionNames = await this.getHistoryCollectionNamesForQueryAsync({query});
        /**
         * mongo db connection
         * @type {import('mongodb').Db}
         */
        const db = await this.getDatabaseConnectionAsync();
        return async.map(collectionNames,
            async collectionName => await this.mongoCollectionManager.getOrCreateCollectionAsync(
                {db, collectionName}));
    }

    /**
     * Gets the history collection for this resource.  If collection does not exist then it is created.
     * @param {Resource} resource
     * @return {Promise<import('mongodb').Collection<import('mongodb').DefaultSchema>>}
     */
    async getOrCreateHistoryCollectionAsync(resource) {
        /**
         * @type {string}
         */
        const collectionName = await this.getHistoryCollectionNameAsync(resource);
        /**
         * mongo db connection
         * @type {import('mongodb').Db}
         */
        const db = await this.getDatabaseConnectionAsync();
        return await this.mongoCollectionManager.getOrCreateCollectionAsync({db, collectionName});
    }
}


module.exports = {
    ResourceLocator
};
