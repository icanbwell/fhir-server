const globals = require('../../globals');
const {AUDIT_EVENT_CLIENT_DB, ATLAS_CLIENT_DB, CLIENT_DB} = require('../../constants');
const {getOrCreateCollectionAsync} = require('../../utils/mongoCollectionManager');
const async = require('async');


/**
 * This class returns collections that contain the requested resourceType
 */
class ResourceLocator {

    /**
     * returns the collection name for resourceType
     * @param {string} resourceType
     * @param {string} base_version
     * @param {Resource} resource
     * @returns {string}
     */
    // eslint-disable-next-line no-unused-vars
    getCollectionNameForResourceType(resourceType, base_version, resource) {
        console.assert(!resourceType.endsWith('4_0_0'), `resourceType ${resourceType} has an invalid postfix`);
        return `${resourceType}_${base_version}`;
    }


    /**
     * returns the collection name for resourceType
     * @param {string} resourceType
     * @param {string} base_version
     * @returns {string[]}
     */
    getCollectionNamesForQueryForResourceType(resourceType, base_version) {
        console.assert(!resourceType.endsWith('4_0_0'), `resourceType ${resourceType} has an invalid postfix`);
        return [`${resourceType}_${base_version}`];
    }

    /**
     * returns the collection name for resourceType
     * @param {string} resourceType
     * @param {string} base_version
     * @param {Resource} resource
     * @returns {string}
     */
// eslint-disable-next-line no-unused-vars
    getHistoryCollectionNameForResourceType(resourceType, base_version, resource) {
        console.assert(!resourceType.endsWith('_History'), `resourceType ${resourceType} has an invalid postfix`);
        return `${resourceType}_${base_version}_History`;
    }

    /**
     * returns the collection name for resourceType
     * @param {string} resourceType
     * @param {string} base_version
     * @returns {string[]}
     */
    getHistoryCollectionNamesForQueryForResourceType(resourceType, base_version) {
        console.assert(!resourceType.endsWith('_History'), `resourceType ${resourceType} has an invalid postfix`);
        return [`${resourceType}_${base_version}_History`];
    }

    /**
     * Gets the database connection for the given collection
     * @param {string} resourceType
     * @param {boolean?} useAtlas
     * @returns {import('mongodb').Db}
     */
    getDatabaseConnectionForResourceType(resourceType, useAtlas) {
        return (resourceType === 'AuditEvent') ?
            globals.get(AUDIT_EVENT_CLIENT_DB) : (useAtlas && globals.has(ATLAS_CLIENT_DB)) ?
                globals.get(ATLAS_CLIENT_DB) : globals.get(CLIENT_DB);
    }

    /**
     *
     * @param {string} resourceType
     * @param {boolean|null} useAtlas
     * @param {string} collectionName
     * @return {Promise<import('mongodb').Collection<import('mongodb').DefaultSchema>>}
     */
    async getOrCreateCollectionForCollectionNameAsync(resourceType, useAtlas, collectionName) {
        /**
         * mongo db connection
         * @type {import('mongodb').Db}
         */
        const db = this.getDatabaseConnectionForResourceType(resourceType, useAtlas);
        return await getOrCreateCollectionAsync(db, collectionName);
    }

    /**
     * Gets the Mongo collection for this resourceType.  If collection does not exist then it is created
     * @param {string} resourceType
     * @param {string} base_version
     * @param {boolean} useAtlas
     * @param {Resource} resource
     * @return {Promise<import('mongodb').Collection<import('mongodb').DefaultSchema>>}
     */
    async getOrCreateCollectionForResourceTypeAsync(resourceType, base_version, useAtlas, resource) {
        /**
         * @type {string}
         */
        const collectionName = this.getCollectionNameForResourceType(resourceType, base_version, resource);
        return await this.getOrCreateCollectionForCollectionNameAsync(resourceType, useAtlas, collectionName);
    }

    /**
     * Gets the Mongo collection for this resourceType.  If collection does not exist then it is created
     * @param {string} resourceType
     * @param {string} base_version
     * @param {boolean} useAtlas
     * @return {Promise<import('mongodb').Collection<import('mongodb').DefaultSchema>[]>}
     */
    async getOrCreateCollectionsForQueryForResourceTypeAsync(resourceType, base_version, useAtlas) {
        /**
         * @type {string[]}
         */
        const collectionNames = this.getCollectionNamesForQueryForResourceType(resourceType, base_version);
        /**
         * mongo db connection
         * @type {import('mongodb').Db}
         */
        const db = this.getDatabaseConnectionForResourceType(resourceType, useAtlas);
        return async.map(collectionNames, async collectionName => await getOrCreateCollectionAsync(db, collectionName));
    }

    /**
     * Gets the Mongo collection for this resourceType.  If collection does not exist then it is created
     * @param {string} resourceType
     * @param {string} base_version
     * @param {boolean} useAtlas
     * @return {Promise<import('mongodb').Collection<import('mongodb').DefaultSchema>[]>}
     */
    async getOrCreateHistoryCollectionsForQueryForResourceTypeAsync(resourceType, base_version, useAtlas) {
        /**
         * @type {string[]}
         */
        const collectionNames = this.getHistoryCollectionNamesForQueryForResourceType(resourceType, base_version);
        /**
         * mongo db connection
         * @type {import('mongodb').Db}
         */
        const db = this.getDatabaseConnectionForResourceType(resourceType, useAtlas);
        return async.map(collectionNames, async collectionName => await getOrCreateCollectionAsync(db, collectionName));
    }

    /**
     * Gets the Mongo history collection for this resourceType.  If collection does not exist then it is created
     * @param {string} resourceType
     * @param {string} base_version
     * @param {boolean} useAtlas
     * @param {Resource} resource
     * @return {Promise<import('mongodb').Collection<import('mongodb').DefaultSchema>>}
     */
    async getOrCreateHistoryCollectionForResourceTypeAsync(resourceType, base_version, useAtlas, resource) {
        /**
         * @type {string}
         */
        const collectionName = this.getHistoryCollectionNameForResourceType(resourceType, base_version, resource);
        /**
         * mongo db connection
         * @type {import('mongodb').Db}
         */
        const db = this.getDatabaseConnectionForResourceType(resourceType, useAtlas);
        return await getOrCreateCollectionAsync(db, collectionName);
    }
}


module.exports = {
    ResourceLocator
};
