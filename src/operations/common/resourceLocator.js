const globals = require('../../globals');
const {AUDIT_EVENT_CLIENT_DB, ATLAS_CLIENT_DB, CLIENT_DB} = require('../../constants');
const async = require('async');
const {assertIsValid, assertTypeEquals} = require('../../utils/assertType');
const {MongoCollectionManager} = require('../../utils/mongoCollectionManager');

/**
 * This class returns collections that contain the requested resourceType
 */
class ResourceLocator {
    /**
     * @param {MongoCollectionManager} collectionManager
     * @param {string} resourceType
     * @param {string} base_version
     * @param {boolean|null} useAtlas
     */
    constructor({collectionManager, resourceType, base_version, useAtlas}) {
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
    }

    /**
     * returns the collection name for this resource
     * @param {Resource} resource
     * @returns {string}
     */
    // eslint-disable-next-line no-unused-vars
    getCollectionName(resource) {
        assertIsValid(!this._resourceType.endsWith('4_0_0'), `resourceType ${this._resourceType} has an invalid postfix`);
        return `${this._resourceType}_${this._base_version}`;
    }

    /**
     * returns all the collection names for resourceType
     * @returns {string[]}
     */
    getCollectionNamesForQuery() {
        assertIsValid(!this._resourceType.endsWith('4_0_0'), `resourceType ${this._resourceType} has an invalid postfix`);
        return [`${this._resourceType}_${this._base_version}`];
    }

    /**
     * returns the first collection name for resourceType.   Use for debugging only
     * @returns {string}
     */
    getFirstCollectionNameForQuery() {
        assertIsValid(!this._resourceType.endsWith('4_0_0'), `resourceType ${this._resourceType} has an invalid postfix`);
        return [`${this._resourceType}_${this._base_version}`][0];
    }

    /**
     * returns the history collection name for the given resource
     * @param {Resource} resource
     * @returns {string}
     */
// eslint-disable-next-line no-unused-vars
    getHistoryCollectionName(resource) {
        assertIsValid(!this._resourceType.endsWith('_History'), `resourceType ${this._resourceType} has an invalid postfix`);
        return `${this._resourceType}_${this._base_version}_History`;
    }

    /**
     * returns all the collection names for resourceType
     * @returns {string[]}
     */
    getHistoryCollectionNamesForQuery() {
        assertIsValid(!this._resourceType.endsWith('_History'), `resourceType ${this._resourceType} has an invalid postfix`);
        return [`${this._resourceType}_${this._base_version}_History`];
    }

    /**
     * Gets the database connection for the given collection
     * @returns {import('mongodb').Db}
     */
    getDatabaseConnection() {
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
        const db = this.getDatabaseConnection();
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
        const collectionName = this.getCollectionName(resource);
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
        const collectionNames = this.getCollectionNamesForQuery();
        /**
         * mongo db connection
         * @type {import('mongodb').Db}
         */
        const db = this.getDatabaseConnection();
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
        const collectionNames = this.getHistoryCollectionNamesForQuery();
        /**
         * mongo db connection
         * @type {import('mongodb').Db}
         */
        const db = this.getDatabaseConnection();
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
        const collectionName = this.getHistoryCollectionName(resource);
        /**
         * mongo db connection
         * @type {import('mongodb').Db}
         */
        const db = this.getDatabaseConnection();
        return await this.collectionManager.getOrCreateCollectionAsync({db, collection_name: collectionName});
    }
}


module.exports = {
    ResourceLocator
};
