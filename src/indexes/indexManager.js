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
 * @property {Object} keys
 * @property {{name: string, [unique]: boolean|undefined}} options
 * @property {string[]|undefined} [exclude]
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
        /**
         * @type {string[]}
         */
        const properties_to_index = Object.keys(indexSpec);
        /**
         * @type {string}
         */
        let indexName = indexConfig.options.name;
        /**
         * @type {string}
         */
        const columnsText = properties_to_index.join(',');
        // limitations: https://www.mongodb.com/docs/manual/reference/limits/
        try {
            if (!await db.collection(collectionName).indexExists(indexName)) {
                const message = 'Creating index ' + indexName + ' with columnsText: [' + columnsText + ']' +
                    ' in ' + collectionName;
                await logSystemEventAsync(
                    {
                        event: 'createIndex',
                        message,
                        args: {
                            index: indexName,
                            columns: columnsText,
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
                        columns: columnsText,
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
        /**
         * @type {{collectionName: string, indexes: IndexConfig[]}}
         */
        const createIndexResult = await this.getIndexesToCreateForCollectionAsync({collectionName});

        // check if index exists
        let indexesCreated = 0;
        for (const /** @type {IndexConfig} */ indexConfig of createIndexResult.indexes) {
            const createdIndex = await this.createIndexIfNotExistsAsync(
                {
                    db,
                    indexConfig,
                    collectionName
                }
            );
            if (createdIndex) {
                indexesCreated += 1;
            }
        }

        const currentIndexResult = await this.getIndexesInCollectionAsync({collectionName, db});
        return {
            collectionName: currentIndexResult.collectionName,
            indexesCreated,
            indexes: currentIndexResult.indexes
        };
    }

    /**
     * Gets indexes to create for the collection requested
     * @param {string} collectionName
     * @returns {Promise<{collectionName: string, indexes: IndexConfig[]}>}
     */
    async getIndexesToCreateForCollectionAsync({collectionName}) {
        const baseCollectionName = collectionName.endsWith('_4_0_0') ?
            collectionName : collectionName.substring(0, collectionName.indexOf('_4_0_0') + 6);

        // if this is a history collection then we only create an index on id
        /**
         * @type {boolean}
         */
        const isHistoryTable = collectionName.includes('_History');
        /**
         * @type {IndexConfig[]}
         */
        const indexesToCreate = [];

        // first add indexes that are set on all collections (except ones marked exlude)
        for (const [indexCollectionName,
            /** @type {IndexConfig[]} */ indexConfigs]
            of Object.entries(customIndexes)) {
            if (isHistoryTable) {
                if (indexCollectionName === '*_History') {
                    for (const /** @type {IndexConfig} */ indexConfig of indexConfigs) {
                        if (!indexConfig.exclude || !indexConfig.exclude.includes(baseCollectionName)) {
                            indexesToCreate.push(indexConfig);
                        }
                    }
                }
            } else {
                if (indexCollectionName === '*') {
                    for (const /** @type {IndexConfig} */ indexConfig of indexConfigs) {
                        if (!indexConfig.exclude || !indexConfig.exclude.includes(baseCollectionName)) {
                            indexesToCreate.push(indexConfig);
                        }
                    }
                }
                if (baseCollectionName === indexCollectionName) {
                    for (const /** @type {IndexConfig} */ indexConfig of indexConfigs) {
                        if (!indexConfig.exclude || !indexConfig.exclude.includes(baseCollectionName)) {
                            indexesToCreate.push(indexConfig);
                        }
                    }
                }
            }
        }

        return {
            collectionName: collectionName,
            indexes: indexesToCreate
        };
    }

    /**
     * Indexes all the collections
     * @param {string|undefined} [collectionRegex]
     * @return {Promise<{indexes: IndexConfig[], indexesCreated: number, collectionName: string}[]>}
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
     * @returns {Promise<{indexes: IndexConfig[], indexesCreated: number, collectionName: string}[]>}
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
     * @param {string} collectionName
     * @param {boolean|undefined} filterToProblems
     * @returns {Promise<{indexes: {indexConfig: IndexConfig, [missing]:boolean, [extra]: boolean}[], collectionName: string}>}
     */
    async compareCurrentIndexesWithConfigurationInCollectionAsync(
        {
            db,
            collectionName,
            filterToProblems
        }) {

        /**
         * @type {{indexes: {indexConfig: IndexConfig, [missing]:boolean, [extra]: boolean}[], collectionName: string}}
         */
        const compareIndexesResult = {
            collectionName: collectionName,
            indexes: []
        };

        // now get the current indexes on these collections
        /**
         * @type {{indexes: IndexConfig[], collectionName: string}}
         */
        const currentIndexesForCollection = await this.getIndexesInCollectionAsync({
            collectionName,
            db
        });
        // find missing indexes
        /**
         * @type {{collectionName: string, indexes: IndexConfig[]}}
         */
        const indexesToCreate = await this.getIndexesToCreateForCollectionAsync({collectionName});
        // find indexes to create that are not present currently
        for (const /** @type {IndexConfig} */ indexConfig of indexesToCreate.indexes) {
            /**
             * @type {IndexConfig[]}
             */
            const indexesMatchingByName = currentIndexesForCollection.indexes.filter(
                i => i.options.name === indexConfig.options.name
            );
            if (indexesMatchingByName.length === 0) {
                compareIndexesResult.indexes.push(
                    {
                        indexConfig: indexConfig,
                        missing: true
                    }
                );
            }
        }
        // find indexes to remove that are present currently but not in configuration
        for (const /** @type {IndexConfig} */ indexConfig of currentIndexesForCollection.indexes) {
            /**
             * @type {IndexConfig[]}
             */
            const indexesMatchingByName = indexesToCreate.indexes.filter(
                i => i.options.name === indexConfig.options.name
            );
            if (indexesMatchingByName.length >= 0 || indexConfig.options.name === '_id_') {
                if (!filterToProblems) {
                    compareIndexesResult.indexes.push(
                        {
                            indexConfig: indexConfig,
                        }
                    );
                }
            } else {
                compareIndexesResult.indexes.push(
                    {
                        indexConfig: indexConfig,
                        extra: true,
                    }
                );
            }

        }

        return compareIndexesResult;
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
                    keys: i.key,
                    options: {
                        name: i.name,
                        unique: i.unique
                    }
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
            /**
             * @type {{indexes: IndexConfig[], collectionName: string}[]}
             */
            const collectionIndexes = await async.map(
                collection_names,
                async collectionName => await this.getIndexesInCollectionAsync({collectionName, db})
            );
            return collectionIndexes
                .sort(
                    (a, b) =>
                        a.collectionName.localeCompare(b.collectionName));
        } finally {
            await disconnectClientAsync(client);
        }
    }

    /**
     * Gets missingindexes on all the collections
     * @param {boolean|undefined} filterToProblems
     * @return {Promise<{collectionName: string, indexes: IndexConfig[]}[]>}
     */
    async compareCurrentIndexesWithConfigurationInAllCollectionsAsync({filterToProblems}) {
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
            /**
             * @type {{indexes: IndexConfig[], collectionName: string}[]}
             */
            const collectionIndexes = await async.map(
                collection_names,
                async collectionName => await this.compareCurrentIndexesWithConfigurationInCollectionAsync(
                    {
                        collectionName,
                        db,
                        filterToProblems
                    })
            );
            return collectionIndexes
                .sort(
                    (a, b) =>
                        a.collectionName.localeCompare(b.collectionName));
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
            await this.deleteIndexesInAllCollectionsInDatabaseAsync({db, collectionRegex});
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
    async deleteIndexesInAllCollectionsInDatabaseAsync({db, collectionRegex}) {
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
