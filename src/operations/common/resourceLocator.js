const globals = require('../../globals');
const {AUDIT_EVENT_CLIENT_DB, ATLAS_CLIENT_DB, CLIENT_DB} = require('../../constants');
const async = require('async');
const {assertIsValid, assertTypeEquals} = require('../../utils/assertType');
const {MongoCollectionManager} = require('../../utils/mongoCollectionManager');
const {Partitioner} = require('./partitioner');

/**
 * This class returns collections that contain the requested resourceType
 */
class ResourceLocator {
    /**
     * @param {MongoCollectionManager} collectionManager
     * @param {string} resourceType
     * @param {string} base_version
     * @param {Partitioner} partitioner
     * @param {boolean|null} useAtlas
     */
    constructor({collectionManager, resourceType, base_version, partitioner, useAtlas}) {
        assertIsValid(resourceType, 'resourceType is not passed to ResourceLocator constructor');
        assertIsValid(base_version, 'base_version is not passed to ResourceLocator constructor');
        assertTypeEquals(collectionManager, MongoCollectionManager);
        /**
         * @type {MongoCollectionManager}
         */
        this.collectionManager = collectionManager;
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
         * @type {boolean|null}
         * @private
         */
        this._useAtlas = useAtlas;
        /**
         * @type {Partitioner}
         */
        this.partitioner = partitioner;
        assertTypeEquals(partitioner, Partitioner);
    }

    /**
     * returns the collection name for this resource
     * @param {Resource} resource
     * @returns {string}
     */
    async getCollectionNameAsync(resource) {
        assertIsValid(!this._resourceType.endsWith('4_0_0'), `resourceType ${this._resourceType} has an invalid postfix`);
        const partition = await this.partitioner.getPartitionNameAsync(
            {resource, base_version: this._base_version});
        return partition;
    }

    /**
     * returns all the collection names for resourceType
     * @returns {string[]}
     */
    async getCollectionNamesForQueryAsync() {
        assertIsValid(!this._resourceType.endsWith('4_0_0'), `resourceType ${this._resourceType} has an invalid postfix`);
        return await this.partitioner.getAllPartitionsForResourceTypeAsync({
            resourceType: this._resourceType,
            base_version: this._base_version
        });
    }

    /**
     * returns the first collection name for resourceType.   Use for debugging only
     * @returns {string}
     */
    async getFirstCollectionNameForQueryAsync() {
        assertIsValid(!this._resourceType.endsWith('4_0_0'), `resourceType ${this._resourceType} has an invalid postfix`);
        return await this.partitioner.getAllPartitionsForResourceTypeAsync({
            resourceType: this._resourceType,
            base_version: this._base_version
        })[0];
    }

    /**
     * returns the history collection name for the given resource
     * @param {Resource} resource
     * @returns {string}
     */
    async getHistoryCollectionNameAsync(resource) {
        assertIsValid(!this._resourceType.endsWith('_History'), `resourceType ${this._resourceType} has an invalid postfix`);
        const partition = await this.partitioner.getPartitionNameAsync({resource, base_version: this._base_version});
        return `${partition}_History`;
    }

    /**
     * returns all the collection names for resourceType
     * @returns {string[]}
     */
    async getHistoryCollectionNamesForQueryAsync() {
        assertIsValid(!this._resourceType.endsWith('_History'), `resourceType ${this._resourceType} has an invalid postfix`);
        return await this.partitioner.getAllHistoryPartitionsForResourceTypeAsync({
            resourceType: this._resourceType,
            base_version: this._base_version
        });
    }

    /**
     * Gets the database connection for the given collection
     * @returns {import('mongodb').Db}
     */
    async getDatabaseConnectionAsync() {
        // noinspection JSValidateTypes
        return (this._resourceType === 'AuditEvent') ?
            globals.get(AUDIT_EVENT_CLIENT_DB) : (this._useAtlas && globals.has(ATLAS_CLIENT_DB)) ?
                globals.get(ATLAS_CLIENT_DB) : globals.get(CLIENT_DB);
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
        return await this.collectionManager.getOrCreateCollectionAsync(
            {db, collection_name: collectionName});
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
     * Gets all the collections for this resourceType.  If collections do not exist then they are created.
     * @return {Promise<import('mongodb').Collection<import('mongodb').DefaultSchema>[]>}
     */
    async getOrCreateCollectionsForQueryAsync() {
        /**
         * @type {string[]}
         */
        const collectionNames = await this.getCollectionNamesForQueryAsync();
        /**
         * mongo db connection
         * @type {import('mongodb').Db}
         */
        const db = await this.getDatabaseConnectionAsync();
        return async.map(collectionNames,
            async collectionName => await this.collectionManager.getOrCreateCollectionAsync(
                {db, collection_name: collectionName}));
    }

    /**
     * Gets all the collections for this resourceType.  If collections do not exist then they are created.
     * @return {Promise<import('mongodb').Collection<import('mongodb').DefaultSchema>[]>}
     */
    async getOrCreateHistoryCollectionsForQueryAsync() {
        /**
         * @type {string[]}
         */
        const collectionNames = await this.getHistoryCollectionNamesForQueryAsync();
        /**
         * mongo db connection
         * @type {import('mongodb').Db}
         */
        const db = await this.getDatabaseConnectionAsync();
        return async.map(collectionNames,
            async collectionName => await this.collectionManager.getOrCreateCollectionAsync(
                {db, collection_name: collectionName}));
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
        return await this.collectionManager.getOrCreateCollectionAsync({db, collection_name: collectionName});
    }
}


module.exports = {
    ResourceLocator
};
