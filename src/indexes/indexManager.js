/**
 * This file implements code to index the mongo database and to list the current indexes
 */

const async = require('async');
const {customIndexes} = require('./customIndexes');
const {createClientAsync, disconnectClientAsync} = require('../utils/connect');
const {CLIENT_DB} = require('../constants');
const {mongoConfig} = require('../config');
const {logSystemEventAsync, logSystemErrorAsync} = require('../operations/common/logging');
const {ErrorReporter} = require('../utils/slack.logger');
const {assertTypeEquals} = require('../utils/assertType');
const globals = require('../globals');


/**
 * @typedef IndexConfig
 * @type {object}
 * @property {number} v
 * @property {Object} keys
 * @property {string} name
 * @property {boolean|undefined} unique
 */

/**
 * @classdesc Creates and deletes indexes
 */
class IndexManager {
    /**
     * constructor
     * @param {ErrorReporter} errorReporter
     */
    constructor({errorReporter}) {
        assertTypeEquals(errorReporter, ErrorReporter);
        /**
         * @type {ErrorReporter}
         */
        this.errorReporter = errorReporter;
    }

    /**
     * creates a multi key index if it does not exist
     * https://www.mongodb.com/docs/manual/reference/method/db.collection.createIndex/
     * https://www.mongodb.com/docs/drivers/node/current/fundamentals/indexes/
     * @param {import('mongodb').Db} db
     * @param {IndexConfig} indexConfig
     * @param {string} collectionName
     * @return {Promise<boolean>}
     */
    async createIndexIfNotExistsAsync({db, indexConfig, collectionName}) {
        /**
         * @type {import('mongodb').IndexSpecification}
         */
        const indexSpec = indexConfig.keys;
        const properties_to_index = Object.keys(indexSpec);
        let indexName = indexConfig.options.name;
        const columns = properties_to_index.join(',');
        // limitations: https://www.mongodb.com/docs/manual/reference/limits/
        try {
            if (!await db.collection(collectionName).indexExists(indexName)) {
                const message = 'Creating index ' + indexName + ' with columns: [' + columns + ']' +
                    ' in ' + collectionName;
                await logSystemEventAsync(
                    {
                        event: 'createIndex',
                        message,
                        args: {
                            index: indexName,
                            columns: columns,
                            collection: collectionName,
                            indexColumnConfig: indexConfig
                        }
                    }
                );
                await this.errorReporter.reportMessageAsync(
                    {source: 'createIndex', message: message});
                await db.collection(collectionName).createIndex(indexSpec, indexConfig.options);
                return true;
            }
        } catch (e) {
            const message1 = 'Error creating index: ' + indexName + ' for collection ' + collectionName +
                ': ' + JSON.stringify(e);
            await logSystemErrorAsync(
                {
                    event: 'createIndex', message: message1, args: {
                        index: indexName,
                        columns: columns,
                        collection: collectionName
                    },
                    error: e
                }
            );
            await this.errorReporter.reportMessageAsync({source: 'createIndex', message: message1});
        }
        return false;
    }

    /**
     * creates indexes on a collection
     * @param {string} collectionName
     * @param {import('mongodb').Db} db
     * @return {Promise<{indexes: IndexConfig[], indexesCreated: number, collectionName: string}>}
     */
    async indexCollectionAsync({collectionName, db}) {
        if (collectionName.includes('_History')) {
            // don't index history collections
            return {
                collectionName,
                indexesCreated: 0,
                indexes: []
            };
        }

        /**
         * @type {{collectionName: string, indexConfig: IndexConfig[]}[]}
         */
        const indexesToCreate = await this.getIndexesToCreateAsync({collectionName});

        // check if index exists
        let indexesCreated = 0;
        for (
            const /** @type {{collectionName:string, indexConfig: IndexConfig[]}} **/
            indexToCreate of indexesToCreate
            ) {
            for (const /** @type {IndexConfig} */ indexConfig of indexToCreate.indexConfig) {
                const createdIndex = await this.createIndexIfNotExistsAsync(
                    {
                        db,
                        indexConfig: indexConfig,
                        collectionName: indexToCreate.collectionName
                    }
                );
                if (createdIndex) {
                    indexesCreated += 1;
                }
            }
        }

        const indexResult = await this.getIndexesInCollectionAsync({collectionName, db});
        return {
            collectionName: indexResult.collectionName,
            indexesCreated,
            indexes: indexResult.indexes.map(i => {
                return {
                    v: i.v,
                    key: i.key,
                    name: i.name,
                    unique: i.unique
                };
            })
        };
    }

    /**
     * Gets indexes to create for the collection requested
     * @param {string} collectionName
     * @returns {Promise<{collectionName: string, indexConfig: IndexConfig[]}[]>}
     */
    async getIndexesToCreateAsync({collectionName}) {
        const baseCollectionName = collectionName.endsWith('_4_0_0') ?
            collectionName : collectionName.substring(0, collectionName.indexOf('_4_0_0') + 6);

        /**
         * <collectionName: string, indexConfigs: IndexConfig[]>
         * @type {Map<string, IndexConfig[]>}
         */
        const indexesToCreate = new Map();

        // first add indexes that are set on all collections (except ones marked exlude)
        for (const [indexCollectionName,
            /** @type {IndexConfig[]} */ indexConfigs]
            of Object.entries(customIndexes)) {
            if (indexCollectionName === '*') {
                for (const /** @type {IndexConfig} */ indexConfig of indexConfigs) {
                    if (!indexConfig.exclude || !indexConfig.exclude.includes(baseCollectionName)) {
                        if (!indexesToCreate.has(collectionName)) {
                            indexesToCreate.set(collectionName, []);
                        }
                        indexesToCreate.get(collectionName).push(
                            indexConfig
                        );
                    }
                }
            }
            if (baseCollectionName === indexCollectionName) {
                for (const /** @type {IndexConfig} */ indexConfig of indexConfigs) {
                    if (!indexConfig.exclude || !indexConfig.exclude.includes(baseCollectionName)) {
                        if (!indexesToCreate.has(collectionName)) {
                            indexesToCreate.set(collectionName, []);
                        }
                        indexesToCreate.get(collectionName).push(
                            indexConfig
                        );
                    }
                }
            }
        }

        return Array.from(
            indexesToCreate,
            ([key, value]) => {
                return {
                    collectionName: key,
                    indexConfig: value
                };
            }
        );
    }

    /**
     * Indexes all the collections
     * @param {string|undefined} [collectionRegex]
     * @return {Promise<*>}
     */
    async indexAllCollectionsAsync({collectionRegex} = {}) {
        /**
         * @type {import('mongodb').MongoClient}
         */
        const client = await createClientAsync(mongoConfig);
        /**
         * @type {import('mongodb').Db}
         */
        const db = globals.get(CLIENT_DB);
        try {
            return await this.indexAllCollectionsInDatabaseAsync({
                db, collectionRegex
            });
        } finally {
            await disconnectClientAsync(client);
        }
    }

    /**
     * indexes all collections in this database
     * @param {import('mongodb').Db} db
     * @param {string|undefined} [collectionRegex]
     * @returns {Promise<{indexes: IndexConfig[], indexesCreated: number, name: string}[]>}
     */
    async indexAllCollectionsInDatabaseAsync({db, collectionRegex}) {
        /**
         * @type {string[]}
         */
        let collectionNames = [];
        /**
         * @type {import('mongodb').CommandCursor}
         */
        const commandCursor = db.listCollections();
        await commandCursor.forEach(collection => {
            if (collection.name.indexOf('system.') === -1) {
                collectionNames.push(collection.name);
            }
        });

        if (collectionRegex) {
            collectionNames = collectionNames.filter(c => c.match(collectionRegex) !== null);
        }
        return async.map(
            collectionNames,
            async collectionName => await this.indexCollectionAsync({
                collectionName, db
            })
        );
    }

    /**
     * indexes all collections in this database
     * @param {import('mongodb').Db} db
     * @param {string|undefined} [collectionRegex]
     * @returns {Promise<{indexes: IndexConfig[], collectionName: string}[]>}
     */
    async getAllMissingIndexes({db, collectionRegex}) {
        /**
         * @type {string[]}
         */
        let collectionNames = [];
        /**
         * @type {import('mongodb').CommandCursor}
         */
        const commandCursor = db.listCollections();
        await commandCursor.forEach(collection => {
            if (collection.name.indexOf('system.') === -1) {
                collectionNames.push(collection.name);
            }
        });

        if (collectionRegex) {
            collectionNames = collectionNames.filter(c => c.match(collectionRegex) !== null);
        }

        /**
         * @type {Map<string, IndexConfig[]>}
         */
        const missingIndexes = new Map();

        for (const collectionName of collectionNames) {
            // now get the current indexes on these collections
            /**ƒ
             * @type {{indexes: IndexConfig[], collectionName: string}}
             */
            const currentIndexesForCollection = await this.getIndexesInCollectionAsync({
                collectionName,
                db
            });
            /**
             * @type {{collectionName: string, indexConfig: IndexConfig[]}[]}
             */
            const indexesToCreate = await this.getIndexesToCreateAsync({collectionName});
            for (
                const /** @type {{collectionName: string, indexConfig: IndexConfig[]}} */
                indexToCreate of indexesToCreate) {
                for (const indexConfig of indexToCreate.indexConfig) {
                    const indexesMatchingByName = currentIndexesForCollection.indexes.filter(
                        i => i.name === indexConfig.name
                    );
                    if (indexesMatchingByName.length === 0) {
                        if (!missingIndexes.has(collectionName)) {
                            missingIndexes.set(collectionName, []);
                        }
                        missingIndexes.get(collectionName).push(indexConfig);
                    }
                }
            }
        }

        return [...missingIndexes];
    }

    /**
     * Gets the current indexes on the specified collection
     * @param {string} collectionName
     * @param {import('mongodb').Db} db
     * @return {Promise<{indexes: IndexConfig[], collectionName: string}>}
     */
    async getIndexesInCollectionAsync({collectionName, db}) {
        // check if index exists
        const indexes = await db.collection(collectionName).indexes();
        return {
            collectionName,
            indexes: indexes.map(i => {
                return {
                    v: i.v,
                    key: i.key,
                    name: i.name,
                    unique: i.unique
                };
            })
        };
    }

    /**
     * Deletes the current indexes on the specified collection
     * @param {string} collection_name
     * @param {import('mongodb').Db} db
     * @return {Promise<{indexes:IndexConfig[], name}>}
     */
    async deleteIndexesInCollectionAsync({collection_name, db}) {
        await db.collection(collection_name).dropIndexes();
    }

    /**
     * Gets indexes on all the collections
     * @return {Promise<{collectionName: string, indexes: IndexConfig[]}[]>}
     */
    async getIndexesInAllCollectionsAsync() {
        /**
         * @type {import('mongodb').MongoClient}
         */
        const client = await createClientAsync(mongoConfig);
        try {
            /**
             * @type {import('mongodb').Db}
             */
            const db = globals.get(CLIENT_DB);
            const collection_names = [];

            for await (const collection of db.listCollections()) {
                if (collection.name.indexOf('system.') === -1) {
                    collection_names.push(collection.name);
                }
            }
            // now add indices on id column for every collection
            return await async.map(
                collection_names,
                async collectionName => await this.getIndexesInCollectionAsync({collectionName, db})
            );
        } finally {
            await disconnectClientAsync(client);
        }
    }

    /**
     * Delete indexes on all the collections
     * @param {string|undefined} [collectionRegex]
     * @return {Promise<*>}
     */
    async deleteIndexesInAllCollectionsAsync({collectionRegex}) {
        /**
         * @type {import('mongodb').MongoClient}
         */
        const client = await createClientAsync(mongoConfig);
        /**
         * @type {import('mongodb').Db}
         */
        const db = globals.get(CLIENT_DB);
        try {
            await this.deleteIndexesInAllCollectionsInDatabase({db, collectionRegex});
        } finally {
            await disconnectClientAsync(client);
        }
    }

    /**
     * deletes all indexes in database where collection name starts with collectionNameStartsWith
     * @param {import('mongodb').Db} db
     * @param {string|undefined} [collectionRegex]
     * @returns {Promise<void>}
     */
    async deleteIndexesInAllCollectionsInDatabase({db, collectionRegex}) {
        /**
         * @type {string[]}
         */
        let collectionNames = [];

        for await (const collection of db.listCollections()) {
            if (collection.name.indexOf('system.') === -1) {
                collectionNames.push(collection.name);
            }
        }

        if (collectionRegex) {
            collectionNames = collectionNames.filter(c => c.match(collectionRegex) !== null);
        }

        for await (const collectionName of collectionNames) {
            console.log(JSON.stringify({message: 'Deleting all indexes in ' + collectionName}));
            await this.deleteIndexesInCollectionAsync({collection_name: collectionName, db});
        }

        console.log(JSON.stringify({message: 'Finished deleteIndexesInAllCollections'}));
    }
}

module.exports = {
    IndexManager
};
