/**
 * This file implements code to index the mongo database and to list the current indexes
 */

const async = require('async');
const env = require('var');

const {logMessageToSlackAsync} = require('../utils/slack.logger');
const {customIndexes} = require('./customIndexes');
const {createClient, disconnectClient} = require('../utils/connect');
const {CLIENT_DB} = require('../constants');

/**
 * creates a multi key index if it does not exist
 * @param {import('mongodb').Db} db
 * @param {string[]} properties_to_index
 * @param {string} collection_name
 * @param {string?} index_name
 * @return {Promise<boolean>}
 */
async function create_index_if_not_exists(db, properties_to_index, collection_name, index_name) {
    // from https://docs.aws.amazon.com/documentdb/latest/developerguide/limits.html#limits.naming
    // Index name: <col>$<index> :	 Length is [3–63] characters.
    // total length combines both collection name and index name
    const mex_fully_qualified_index_name_length = (env.MAX_FULLY_QUALIFIED_INDEX_NAME_LENGTH ? parseInt(env.MAX_FULLY_QUALIFIED_INDEX_NAME_LENGTH) : 127) - collection_name.length - 1;
    let mex_index_name_length = (env.MAX_INDEX_NAME_LENGTH ? parseInt(env.MAX_INDEX_NAME_LENGTH) : 63);
    mex_index_name_length = Math.min(mex_index_name_length, mex_fully_qualified_index_name_length);
    index_name = index_name.slice(0, mex_index_name_length - 1) || (properties_to_index.join('_1_') + '_1').slice(0, mex_index_name_length - 1);
    try {
        if (!await db.collection(collection_name).indexExists(index_name)) {
            const message = 'Creating index ' + index_name + ' with columns: [' + properties_to_index.join(',') + ']' + ' in ' + collection_name;
            console.log(message);
            await logMessageToSlackAsync(message);
            const my_dict = {};
            for (const property_to_index of properties_to_index) {
                my_dict[String(property_to_index)] = 1;
            }
            await db.collection(collection_name).createIndex(my_dict, {name: index_name});
            return true;
        }
    } catch (e) {
        console.log('Error creating index: ' + index_name + ' for collection ' + collection_name + ': ' + JSON.stringify(e));
        await logMessageToSlackAsync('Error creating index: ' + index_name + ' for collection ' + collection_name + ': ' + JSON.stringify(e));
    }
    return false;
}

/**
 * creates indexes on a collection
 * @param {string} collection_name
 * @param {import('mongodb').Db} db
 * @return {Promise<{indexes: *, createdIndex: boolean, name, count: *}>}
 */
async function indexCollection(collection_name, db) {
    console.log('Processing collection', collection_name);
    // check if index exists
    let createdIndex = false;

    // now add custom indices
    for (const [collection, indexesArray] of Object.entries(customIndexes)) {
        if (collection === '*') {
            console.log('Creating Standard Indexes: ', collection_name);
            for (const indexDefinition of indexesArray) {
                for (const [indexName, indexColumns] of Object.entries(indexDefinition)) {
                    createdIndex = await create_index_if_not_exists(db, indexColumns, collection_name, indexName) || createdIndex;
                }
            }
        }
    }

    for (const [collection, indexesArray] of Object.entries(customIndexes)) {
        if (collection === collection_name) {
            console.log('Creating Custom Indexes: ', collection_name);
            for (const indexDefinition of indexesArray) {
                for (const [indexName, indexColumns] of Object.entries(indexDefinition)) {
                    createdIndex = await create_index_if_not_exists(db, indexColumns, collection_name, indexName) || createdIndex;
                }
            }
        }
    }

    const indexes = await db.collection(collection_name).indexes();
    return {
        name: collection_name,
        createdIndex: createdIndex,
        indexes: indexes
    };
}

/**
 * Indexes all the collections
 * @param {string?} tableName
 * @return {Promise<*>}
 */
async function indexAllCollections(tableName) {
    /**
     * @type {import("mongodb").MongoClient}
     */
    const client = await createClient();
    try {
        /**
         * @type {import('mongodb').Db}
         */
        const db = client.db(CLIENT_DB);
        let collection_names = [];
        // const collections = await db.listCollections().toArray();

        await db.listCollections().forEach(collection => {
            if (collection.name.indexOf('system.') === -1) {
                collection_names.push(collection.name);
            }
        });

        if (tableName) {
            collection_names = collection_names.filter(c => c === tableName);
        }
        // now add indices on id column for every collection
        return async.map(
            collection_names,
            async collection_name => await indexCollection(collection_name, db)
        );
    } finally {
        await disconnectClient(client);
    }
}

/**
 * Gets the current indexes on the specified collection
 * @param {string} collection_name
 * @param {import('mongodb').Db} db
 * @return {Promise<{indexes: *, name}>}
 */
async function getIndexesInCollection(collection_name, db) {
    // check if index exists
    const indexes = await db.collection(collection_name).indexes();
    return {
        name: collection_name,
        indexes: indexes
    };
}

/**
 * Deletes the current indexes on the specified collection
 * @param {string} collection_name
 * @param {import('mongodb').Db} db
 * @return {Promise<{indexes: *, name}>}
 */
async function deleteIndexesInCollection(collection_name, db) {
    await db.collection(collection_name).dropIndexes();
}

/**
 * Gets indexes on all the collections
 * @return {Promise<*>}
 */
async function getIndexesInAllCollections() {
    /**
     * @type {import("mongodb").MongoClient}
     */
    const client = await createClient();
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
            async collection_name => await getIndexesInCollection(collection_name, db)
        );
    } finally {
        await disconnectClient(client);
    }
}

/**
 * Delete indexes on all the collections
 * @param {string?} tableName
 * @return {Promise<*>}
 */
async function deleteIndexesInAllCollections(tableName) {
    console.log('starting deleteIndexesInAllCollections');
    /**
     * @type {import("mongodb").MongoClient}
     */
    const client = await createClient();
    try {
        /**
         * @type {import('mongodb').Db}
         */
        const db = client.db(CLIENT_DB);
        let collection_names = [];

        for await (const collection of db.listCollections()) {
            if (collection.name.indexOf('system.') === -1) {
                collection_names.push(collection.name);
            }
        }

        if (tableName) {
            collection_names = collection_names.filter(c => c === tableName);
        }

        for await (const collection_name of collection_names) {
            console.log('Deleting all indexes in ' + collection_name);
            await deleteIndexesInCollection(collection_name, db);
        }

        console.log('Finished deleteIndexesInAllCollections');
    } finally {
        await disconnectClient(client);
    }
}

module.exports = {
    indexAllCollections,
    indexCollection,
    getIndexesInAllCollections,
    deleteIndexesInAllCollections
};
