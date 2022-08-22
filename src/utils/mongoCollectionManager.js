/**
 * This file implements a function to get or create a mongo collection.  It uses a mutex to prevent multiple node.js processes
 *  from trying to do this operation at the same time
 */

const Mutex = require('async-mutex').Mutex;
const mutex = new Mutex();

const {isTrue} = require('./isTrue');
const env = require('var');
const assert = require('node:assert/strict');
const {IndexManager} = require('../indexes/index.util');

class MongoCollectionManager {
    /**
     * Constructor
     * @param {IndexManager} indexManager
     */
    constructor(indexManager) {
        assert(indexManager);
        assert(indexManager instanceof IndexManager);
        /**
         * @type {IndexManager}
         */
        this.indexManager = indexManager;
    }

    /**
     * Gets or creates a collection
     * @param {import('mongodb').Db} db
     * @param {string} collection_name
     * @return {Promise<import('mongodb').Collection>}
     */
    async getOrCreateCollectionAsync(db, collection_name) {
        assert(db !== undefined);
        assert(collection_name !== undefined);
        // use mutex to prevent parallel async calls from trying to create the collection at the same time
        await mutex.runExclusive(async () => {
            const collectionExists = await db.listCollections({name: collection_name}, {nameOnly: true}).hasNext();
            if (!collectionExists) {
                await db.createCollection(collection_name);
                if (isTrue(env.CREATE_INDEX_ON_COLLECTION_CREATION)) {
                    // and index it
                    await this.indexManager.indexCollectionAsync(collection_name, db);
                }
            }
        });
        return db.collection(collection_name);
    }
}

module.exports = {
    MongoCollectionManager
};
