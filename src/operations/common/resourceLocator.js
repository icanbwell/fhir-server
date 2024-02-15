const async = require('async');
const {assertIsValid, assertTypeEquals} = require('../../utils/assertType');
const {MongoCollectionManager} = require('../../utils/mongoCollectionManager');
const {PartitioningManager} = require('../../partitioners/partitioningManager');
const {MongoDatabaseManager} = require('../../utils/mongoDatabaseManager');
const {RethrownError} = require('../../utils/rethrownError');
const Resource = require('../../fhir/classes/4_0_0/resources/resource');

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
    constructor ({
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
     * @returns {Promise<string>}
     */
    async getCollectionNameAsync (resource) {
        assertIsValid(!this._resourceType.endsWith('4_0_0'), `resourceType ${this._resourceType} has an invalid postfix`);
        assertIsValid(resource, 'resource is null');
        return await this.partitioningManager.getPartitionNameByResourceAsync(
            {resource, base_version: this._base_version});
    }

    /**
     * returns unique collections names for the provided resources
     * @param {Resource[]} resources
     * @returns {Promise<string[]>}
     */
    async getCollectionNamesAsync ({resources}) {
        assertIsValid(!this._resourceType.endsWith('4_0_0'), `resourceType ${this._resourceType} has an invalid postfix`);
        return await this.partitioningManager.getPartitionNamesByResourcesAsync(
            {resources, base_version: this._base_version}
        );
    }

    /**
     * returns all the collection names for resourceType
     * @param {import('mongodb').Filter<import('mongodb').DefaultSchema>} query
     * @param {Object} [extraInfo]
     * @returns {Promise<string[]>}
     */
    async getCollectionNamesForQueryAsync ({query, extraInfo = {}}) {
        assertIsValid(!this._resourceType.endsWith('4_0_0'), `resourceType ${this._resourceType} has an invalid postfix`);
        return await this.partitioningManager.getPartitionNamesByQueryAsync({
            resourceType: this._resourceType,
            base_version: this._base_version,
            query,
            extraInfo
        });
    }

    /**
     * returns the first collection name for resourceType.   Use for debugging only
     * @param {import('mongodb').Filter<import('mongodb').DefaultSchema>} [query]
     * @returns {Promise<string>}
     */
    async getFirstCollectionNameForQueryDebugOnlyAsync ({query}) {
        try {
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
        } catch (e) {
            throw new RethrownError({
                message: 'getFirstCollectionNameForQueryDebugOnlyAsync()',
                error: e,
                args: {
                    query
                }
            });
        }
    }

    /**
     * returns the history collection name for the given resource
     * @param {Resource} resource
     * @returns {Promise<string>}
     */
    async getHistoryCollectionNameAsync (resource) {
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
     * @returns {Promise<string[]>}
     */
    async getHistoryCollectionNamesForQueryAsync ({query}) {
        assertIsValid(!this._resourceType.endsWith('_History'), `resourceType ${this._resourceType} has an invalid postfix`);
        return await this.partitioningManager.getAllHistoryPartitionsForResourceTypeAsync({
            resourceType: this._resourceType,
            base_version: this._base_version,
            query
        });
    }

    /**
     * Gets the database connection for the given collection
     * @param {Object} [extraInfo]
     * @returns {Promise<import('mongodb').Db>}
     */
    async getDatabaseConnectionAsync (extraInfo = {}) {
        // noinspection JSValidateTypes
        return await this.mongoDatabaseManager.getDatabaseForResourceAsync(
            {
                resourceType: this._resourceType,
                extraInfo
            });
    }

    /**
     * Creates a db collection for given collection name
     * @param {string} collectionName
     * @return {Promise<import('mongodb').Collection<import('mongodb').DefaultSchema>>}
     */
    async getOrCreateCollectionAsync (collectionName) {
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
    async getOrCreateCollectionForResourceAsync (resource) {
        assertTypeEquals(resource, Resource);
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
    async getOrCreateCollectionsAsync ({resources}) {
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
     * @param {Object} extraInfo
     * @return {Promise<import('mongodb').Collection<import('mongodb').DefaultSchema>[]>}
     */
    async getOrCreateCollectionsForQueryAsync ({query, extraInfo = {}}) {
        /**
         * @type {string[]}
         */
        const collectionNames = await this.getCollectionNamesForQueryAsync({query, extraInfo});
        /**
         * mongo db connection
         * @type {import('mongodb').Db}
         */
        const db = await this.getDatabaseConnectionAsync(extraInfo);
        return async.map(collectionNames,
            async collectionName => await this.mongoCollectionManager.getOrCreateCollectionAsync(
                {db, collectionName}));
    }

    /**
     * Gets all the collections for this resourceType.  If collections do not exist then they are created.
     * @param {import('mongodb').Filter<import('mongodb').DefaultSchema>} [query]
     * @return {Promise<import('mongodb').Collection<import('mongodb').DefaultSchema>[]>}
     */
    async getOrCreateHistoryCollectionsForQueryAsync ({query}) {
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
    async getOrCreateHistoryCollectionAsync (resource) {
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
