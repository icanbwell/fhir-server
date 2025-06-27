const { ACCESS_LOGS_COLLECTION_NAME } = require('../../constants');
const { assertIsValid, assertTypeEquals } = require('../../utils/assertType');
const { MongoCollectionManager } = require('../../utils/mongoCollectionManager');
const { MongoDatabaseManager } = require('../../utils/mongoDatabaseManager');
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
     */
    constructor({ mongoDatabaseManager, mongoCollectionManager, resourceType, base_version }) {
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
         * @type {MongoDatabaseManager}
         */
        this.mongoDatabaseManager = mongoDatabaseManager;
        assertTypeEquals(mongoDatabaseManager, MongoDatabaseManager);
    }

    /**
     * returns the collection name for given resource
     * @param {Resource} resource
     * @returns {string}
     */
    getCollectionNameForResource(resource) {
        assertIsValid(resource, 'resource is null');
        return `${resource.resourceType}_${this._base_version}`;
    }

    /**
     * returns the collection name
     * @returns {string}
     */
    getCollectionName() {
        assertIsValid(this._resourceType, '_resourceType is null');
        return `${this._resourceType}_${this._base_version}`;
    }

    /**
     * returns unique collections names for the provided resources
     * @param {Resource[]} resources
     * @returns {string[]}
     */
    getCollectionNames({ resources }) {
        let collectionNames = resources.map((resource) => {
            assertIsValid(resource, 'resource is null');
            return this.getCollectionNameForResource(resource);
        });
        return Array.from(new Set(collectionNames)); // return unique collection names
    }

    /**
     * returns the history collection name for the given resource
     * @param {Resource} resource
     * @returns {string}
     */
    getHistoryCollectionName(resource) {
        assertIsValid(resource, 'resource is null');
        return `${resource.resourceType}_${this._base_version}_History`;
    }

    /**
     * returns history the collection names for resourceType
     * @returns {string}
     */
    getHistoryCollectionNameForQuery() {
        assertIsValid(
            !this._resourceType.endsWith('_History'),
            `resourceType ${this._resourceType} has an invalid postfix`
        );
        if (this._resourceType === 'AuditEvent') {
            return null;
        }
        return `${this._resourceType}_${this._base_version}_History`;
    }

    /**
     * Gets the database connection for the given collection
     * @param {Object} [extraInfo]
     * @returns {Promise<import('mongodb').Db>}
     */
    async getDatabaseConnectionAsync(extraInfo = {}) {
        // noinspection JSValidateTypes
        return await this.mongoDatabaseManager.getDatabaseForResourceAsync({
            resourceType: this._resourceType,
            extraInfo
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
        const db = await this.getDatabaseConnectionAsync({ isHistoryQuery: collectionName.endsWith('_History') });
        return await this.mongoCollectionManager.getOrCreateCollectionAsync({ db, collectionName });
    }

    /**
     * Creates a db collection for access log
     * @return {Promise<import('mongodb').Collection<import('mongodb').DefaultSchema>>}
     */
    async getOrCreateAccessLogCollectionAsync() {
        /**
         * Access log mongo db connection
         * @type {import('mongodb').Db}
         */
        const db = await this.mongoDatabaseManager.getAccessLogsDbAsync();
        return await this.mongoCollectionManager.getOrCreateCollectionAsync({
            db,
            collectionName: ACCESS_LOGS_COLLECTION_NAME
        });
    }

    /**
     * Gets the collection for this resource.  If collection does not exist then it is created
     * @param {Resource} resource
     * @return {Promise<import('mongodb').Collection<import('mongodb').DefaultSchema>>}
     */
    async getOrCreateCollectionForResourceAsync(resource) {
        assertTypeEquals(resource, Resource);
        /**
         * @type {string}
         */
        const collectionName = this.getCollectionNameForResource(resource);
        return await this.getOrCreateCollectionAsync(collectionName);
    }

    /**
     * Gets collection for this resourceType.  If collection do not exist then it is created.
     * @param {Object} extraInfo
     * @return {Promise<import('mongodb').Collection<import('mongodb').DefaultSchema>>}
     */
    async getOrCreateCollectionForQueryAsync({ extraInfo = {} }) {
        /**
         * @type {string[]}
         */
        const collectionName = `${this._resourceType}_${this._base_version}`;
        /**
         * mongo db connection
         * @type {import('mongodb').Db}
         */
        const db = await this.getDatabaseConnectionAsync(extraInfo);
        return await this.mongoCollectionManager.getOrCreateCollectionAsync({ db, collectionName });
    }

    /**
     * Gets the history collection for this resourceType.  If collection do not exist then it is created.
     * @return {Promise<import('mongodb').Collection<import('mongodb').DefaultSchema>>}
     */
    async getOrCreateHistoryCollectionForQueryAsync() {
        const collectionName = this.getHistoryCollectionNameForQuery();
        /**
         * mongo db connection
         * @type {import('mongodb').Db}
         */
        const db = await this.getDatabaseConnectionAsync({ isHistoryQuery: true });
        return await this.mongoCollectionManager.getOrCreateCollectionAsync({ db, collectionName });
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
        const db = await this.getDatabaseConnectionAsync({ isHistoryQuery: true });
        return await this.mongoCollectionManager.getOrCreateCollectionAsync({ db, collectionName });
    }
}

module.exports = {
    ResourceLocator
};
