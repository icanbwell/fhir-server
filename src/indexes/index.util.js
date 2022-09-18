/**
 * This file implements code to index the mongo database and to list the current indexes
 */

const async = require('async');
const env = require('var');

const {customIndexes} = require('./customIndexes');
const {createClientAsync, disconnectClientAsync} = require('../utils/connect');
const {CLIENT_DB} = require('../constants');
const {mongoConfig} = require('../config');
const {logSystemEventAsync, logSystemErrorAsync} = require('../operations/common/logging');
const {ErrorReporter} = require('../utils/slack.logger');
const {assertTypeEquals} = require('../utils/assertType');

/**
 * Manages indexes
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
     * @param {import('mongodb').Db} db
     * @param {{keys:Object, options:Object, exclude: string[]}} indexConfig
     * @param {string} collectionName
     * @return {Promise<boolean>}
     */
    async create_index_if_not_exists({db, indexConfig, collectionName}) {
        const properties_to_index = Object.keys(indexConfig.keys);
        let indexName = indexConfig.options.name;
        // from https://docs.aws.amazon.com/documentdb/latest/developerguide/limits.html#limits.naming
        // Index name: <col>$<index> :	 Length is [3–63] characters.
        // total length combines both collection name and index name
        const mex_fully_qualified_index_name_length = (env.MAX_FULLY_QUALIFIED_INDEX_NAME_LENGTH ?
            parseInt(env.MAX_FULLY_QUALIFIED_INDEX_NAME_LENGTH) : 127) - collectionName.length - 1;
        let mex_index_name_length = (env.MAX_INDEX_NAME_LENGTH ? parseInt(env.MAX_INDEX_NAME_LENGTH) : 63);
        mex_index_name_length = Math.min(mex_index_name_length, mex_fully_qualified_index_name_length);
        indexName = indexName.slice(0, mex_index_name_length - 1) ||
            (properties_to_index.join('_1_') + '_1').slice(0, mex_index_name_length - 1);
        const columns = properties_to_index.join(',');
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
                await db.collection(collectionName).createIndex(indexConfig.keys, indexConfig.options);
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
     * @return {Promise<{indexes: {v:number,key:Object, name:string, unique:boolean|undefined}[], indexesCreated: number, name: string}>}
     */
    async indexCollectionAsync({collectionName, db}) {
        // check if index exists
        let indexesCreated = 0;

        const baseCollectionName = collectionName.endsWith('_4_0_0') ?
            collectionName : collectionName.substring(0, collectionName.indexOf('_4_0_0') + 6);

        // first add indexes that are set on all collections (except ones marked exlude)
        for (const [indexCollectionName,
            /** @type {{keys:Object, options:Object, exclude: string[]}[]} */ indexConfigs]
            of Object.entries(customIndexes)) {
            if (indexCollectionName === '*') {
                for (const /** @type {{keys:Object, options:Object, exclude: string[]}} */ indexConfig of indexConfigs) {
                    if (!indexConfig.exclude || !indexConfig.exclude.includes(baseCollectionName)) {
                        const createdIndex = await this.create_index_if_not_exists(
                            {
                                db, indexConfig, collectionName
                            }
                        );
                        if (createdIndex) {
                            indexesCreated += 1;
                        }
                    }
                }
            }
        }

        // now add indexes for the specific collection
        for (const [indexCollectionName,
            /** @type {{keys:Object, options:Object, exclude: string[]}[]} */ indexConfigs]
            of Object.entries(customIndexes)) {
            if (baseCollectionName === indexCollectionName) {
                for (const /** @type {{keys:Object, options:Object, exclude: string[]}} */ indexConfig of indexConfigs) {
                    if (!indexConfig.exclude || !indexConfig.exclude.includes(baseCollectionName)) {
                        const createdIndex = await this.create_index_if_not_exists(
                            {
                                db, indexConfig, collectionName
                            }
                        );
                        if (createdIndex) {
                            indexesCreated += 1;
                        }
                    }
                }
            }
        }

        const indexes = await db.collection(collectionName).indexes();
        return {
            name: collectionName,
            indexesCreated,
            indexes
        };
    }

    /**
     * Indexes all the collections
     * @param {string?} tableName
     * @return {Promise<*>}
     */
    async indexAllCollectionsAsync({tableName}) {
        /**
         * @type {import('mongodb').MongoClient}
         */
        const client = await createClientAsync(mongoConfig);
        try {
            /**
             * @type {import('mongodb').Db}
             */
            const db = client.db(CLIENT_DB);
            let collectionNames = [];
            // const collections = await db.listCollections().toArray();

            /**
             * @type {import('mongodb').CommandCursor}
             */
            const commandCursor = db.listCollections();
            await commandCursor.forEach(collection => {
                if (collection.name.indexOf('system.') === -1) {
                    collectionNames.push(collection.name);
                }
            });

            if (tableName) {
                collectionNames = collectionNames.filter(c => c === tableName);
            }
            // now add indices on id column for every collection
            return async.map(
                collectionNames,
                async collectionName => await this.indexCollectionAsync({collectionName, db})
            );
        } finally {
            await disconnectClientAsync(client);
        }
    }

    /**
     * Gets the current indexes on the specified collection
     * @param {string} collectionName
     * @param {import('mongodb').Db} db
     * @return {Promise<{indexes: *, name}>}
     */
    async getIndexesInCollectionAsync({collectionName, db}) {
        // check if index exists
        const indexes = await db.collection(collectionName).indexes();
        return {
            name: collectionName,
            indexes: indexes
        };
    }

    /**
     * Deletes the current indexes on the specified collection
     * @param {string} collection_name
     * @param {import('mongodb').Db} db
     * @return {Promise<{indexes: *, name}>}
     */
    async deleteIndexesInCollectionAsync({collection_name, db}) {
        await db.collection(collection_name).dropIndexes();
    }

    /**
     * Gets indexes on all the collections
     * @return {Promise<*>}
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
            const db = client.db(CLIENT_DB);
            const collection_names = [];
            // const collections = await db.listCollections().toArray();

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
     * @param {string?} tableName
     * @return {Promise<*>}
     */
    async deleteIndexesInAllCollectionsAsync({tableName}) {
        /**
         * @type {import('mongodb').MongoClient}
         */
        const client = await createClientAsync(mongoConfig);
        try {
            /**
             * @type {import('mongodb').Db}
             */
            const db = client.db(CLIENT_DB);
            let collectionNames = [];

            for await (const collection of db.listCollections()) {
                if (collection.name.indexOf('system.') === -1) {
                    collectionNames.push(collection.name);
                }
            }

            if (tableName) {
                collectionNames = collectionNames.filter(c => c === tableName);
            }

            for await (const collectionName of collectionNames) {
                console.log(JSON.stringify({message: 'Deleting all indexes in ' + collectionName}));
                await this.deleteIndexesInCollectionAsync({collection_name: collectionName, db});
            }

            console.log(JSON.stringify({message: 'Finished deleteIndexesInAllCollections'}));
        } finally {
            await disconnectClientAsync(client);
        }
    }
}

module.exports = {
    IndexManager
};
