const globals = require('../../globals');
const {AUDIT_EVENT_CLIENT_DB, ATLAS_CLIENT_DB, CLIENT_DB} = require('../../constants');
const {getOrCreateCollectionAsync} = require('../../utils/mongoCollectionManager');
const async = require('async');


// /**
//  * Returns whether this resource is partitioned
//  * @param resourceType
//  * @return {boolean}
//  */
// function isResourcePartitioned(resourceType) {
//     return resourceType === 'AuditEvent';
// }

/**
 * returns the collection name for resourceType
 * @param {string} resourceType
 * @param {string} base_version
 * @param {Resource} resource
 * @returns {string}
 */
// eslint-disable-next-line no-unused-vars
function getCollectionNameForResourceType(resourceType, base_version, resource) {
    console.assert(!resourceType.endsWith('4_0_0'), `resourceType ${resourceType} has an invalid postfix`);
    return `${resourceType}_${base_version}`;
}

/**
 * returns the collection name for resourceType
 * @param {string} resourceType
 * @param {string} base_version
 * @returns {string[]}
 */
function getCollectionNamesForQueryForResourceType(resourceType, base_version) {
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
function getHistoryCollectionNameForResourceType(resourceType, base_version, resource) {
    console.assert(!resourceType.endsWith('_History'), `resourceType ${resourceType} has an invalid postfix`);
    return `${resourceType}_${base_version}_History`;
}

/**
 * returns the collection name for resourceType
 * @param {string} resourceType
 * @param {string} base_version
 * @returns {string[]}
 */
function getHistoryCollectionNamesForQueryForResourceType(resourceType, base_version) {
    console.assert(!resourceType.endsWith('_History'), `resourceType ${resourceType} has an invalid postfix`);
    return [`${resourceType}_${base_version}_History`];
}

/**
 * Gets the database connection for the given collection
 * @param {string} resourceType
 * @param {boolean?} useAtlas
 * @returns {import('mongodb').Db}
 */
function getDatabaseConnectionForResourceType(resourceType, useAtlas) {
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
async function getOrCreateCollectionForCollectionNameAsync(resourceType, useAtlas, collectionName) {
    /**
     * mongo db connection
     * @type {import('mongodb').Db}
     */
    const db = getDatabaseConnectionForResourceType(resourceType, useAtlas);
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
async function getOrCreateCollectionForResourceTypeAsync(resourceType, base_version, useAtlas, resource) {
    /**
     * @type {string}
     */
    const collectionName = getCollectionNameForResourceType(resourceType, base_version, resource);
    return await getOrCreateCollectionForCollectionNameAsync(resourceType, useAtlas, collectionName);
}

/**
 * Gets the Mongo collection for this resourceType.  If collection does not exist then it is created
 * @param {string} resourceType
 * @param {string} base_version
 * @param {boolean} useAtlas
 * @return {Promise<import('mongodb').Collection<import('mongodb').DefaultSchema>[]>}
 */
async function getOrCreateCollectionsForQueryForResourceTypeAsync(resourceType, base_version, useAtlas) {
    /**
     * @type {string[]}
     */
    const collectionNames = getCollectionNamesForQueryForResourceType(resourceType, base_version);
    /**
     * mongo db connection
     * @type {import('mongodb').Db}
     */
    const db = getDatabaseConnectionForResourceType(resourceType, useAtlas);
    return async.map(collectionNames, async collectionName => await getOrCreateCollectionAsync(db, collectionName));
}

/**
 * Gets the Mongo collection for this resourceType.  If collection does not exist then it is created
 * @param {string} resourceType
 * @param {string} base_version
 * @param {boolean} useAtlas
 * @return {Promise<import('mongodb').Collection<import('mongodb').DefaultSchema>[]>}
 */
async function getOrCreateHistoryCollectionsForQueryForResourceTypeAsync(resourceType, base_version, useAtlas) {
    /**
     * @type {string[]}
     */
    const collectionNames = getHistoryCollectionNamesForQueryForResourceType(resourceType, base_version);
    /**
     * mongo db connection
     * @type {import('mongodb').Db}
     */
    const db = getDatabaseConnectionForResourceType(resourceType, useAtlas);
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
async function getOrCreateHistoryCollectionForResourceTypeAsync(resourceType, base_version, useAtlas, resource) {
    /**
     * @type {string}
     */
    const collectionName = getHistoryCollectionNameForResourceType(resourceType, base_version, resource);
    /**
     * mongo db connection
     * @type {import('mongodb').Db}
     */
    const db = getDatabaseConnectionForResourceType(resourceType, useAtlas);
    return await getOrCreateCollectionAsync(db, collectionName);
}


module.exports = {
    getCollectionNameForResourceType,
    getOrCreateCollectionForResourceTypeAsync,
    getOrCreateCollectionsForQueryForResourceTypeAsync,
    getOrCreateHistoryCollectionForResourceTypeAsync,
    getCollectionNamesForQueryForResourceType,
    getHistoryCollectionNamesForQueryForResourceType,
    getOrCreateHistoryCollectionsForQueryForResourceTypeAsync,
    getOrCreateCollectionForCollectionNameAsync,
    getHistoryCollectionNameForResourceType
};
