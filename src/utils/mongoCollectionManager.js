/**
 * This file implements a function to get or create a mongo collection.  It uses a mutex to prevent multiple node.js processes
 *  from trying to do this operation at the same time
 */

const Mutex = require('async-mutex').Mutex;
const mutex = new Mutex();

const {IndexManager} = require('../indexes/indexManager');
const {assertTypeEquals, assertIsValid} = require('./assertType');
const {ConfigManager} = require('./configManager');
const {MongoDatabaseManager} = require('./mongoDatabaseManager');
const {logInfo} = require('../operations/common/logging');

class MongoCollectionManager {
    /**
     * Constructor
     * @param {IndexManager} indexManager
     * @param {ConfigManager} configManager
     * @param {MongoDatabaseManager} mongoDatabaseManager
     */
    constructor({indexManager, configManager, mongoDatabaseManager}) {
        /**
         * @type {IndexManager}
         */
        this.indexManager = indexManager;
        assertTypeEquals(indexManager, IndexManager);

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        /**
         * @type {MongoDatabaseManager}
         */
        this.mongoDatabaseManager = mongoDatabaseManager;
        assertTypeEquals(mongoDatabaseManager, MongoDatabaseManager);

        /**
         * @type {Set}
         */
        this.databaseCollectionNameSet = null;
    }

    /**
     * adds existing collections in db to databaseCollectionStatusMap
     * @return {Promise<void>}
     */
    async addExisitingCollectionsToMap() {
        if (this.databaseCollectionNameSet === null) {
            const fhirDb = await this.mongoDatabaseManager.getClientDbAsync();
            const auditDb = await this.mongoDatabaseManager.getAuditDbAsync();

            const fhirCollections = await this.getAllCollectionNames({db: fhirDb});
            const auditCollections = await this.getAllCollectionNames({db: auditDb});

            this.databaseCollectionNameSet = new Set([...fhirCollections, ...auditCollections]);

            logInfo('Collection added to cache', Array.from(this.databaseCollectionNameSet));
        } else {
            logInfo('No collections added to cache', []);
        }
    }

    /**
     * Gets or creates a collection
     * @param {import('mongodb').Db} db
     * @param {string} collectionName
     * @return {Promise<import('mongodb').Collection>}
     */
    async getOrCreateCollectionAsync({db, collectionName}) {
        assertIsValid(db !== undefined);
        assertIsValid(collectionName !== undefined);

        // use mutex to prevent parallel async calls from trying to create the collection at the same time
        if (this.databaseCollectionNameSet === null || !this.databaseCollectionNameSet.has(collectionName)) {
            await mutex.runExclusive(async () => {
                if (this.databaseCollectionNameSet === null) {
                    await this.addExisitingCollectionsToMap();
                    if (this.databaseCollectionNameSet.has(collectionName)) {
                        return;
                    }
                }
                const collectionExists = await db.listCollections({name: collectionName}, {nameOnly: true}).hasNext();
                if (!collectionExists) {
                    await db.createCollection(collectionName);
                    if (this.configManager.createIndexOnCollectionCreation) {
                        // and index it
                        await this.indexManager.indexCollectionAsync({collectionName, db});
                    }
                }
                this.databaseCollectionNameSet.add(collectionName);
            });
        } else {
            await mutex.waitForUnlock();
        }

        return db.collection(collectionName);
    }

    /**
     * Returns the list of all collection names specific to a db
     * @param {import('mongodb').Db} db
     * @return {Promise<string[]>}
     */
    async getAllCollectionNames({db}) {
        /**
         * @type {string[]}
         */
        const collectionNames = [];
        for await (const /** @type {{name: string, type: string}} */ collection of db.listCollections(
            {type: {$ne: 'view'}}, {nameOnly: true})) {
            if (this.isNotSystemCollection(collection.name)) {
                collectionNames.push(collection.name);
            }
        }
        return collectionNames;
    }

    /**
     * Check if a collection is a valid collection and not a system collection
     * @param {String} collectionName
     * @returns {boolean}
     */
    isNotSystemCollection(collectionName) {
        const systemCollectionNames = ['system.', 'fs.files', 'fs.chunks'];
        return !systemCollectionNames.some(systemCollectionName => collectionName.indexOf(systemCollectionName) !== -1);
    }

    /**
     * Does a distinct count
     * @param {import('mongodb').Collection} collection
     * @param {import('mongodb').Filter<import('mongodb').Document>} query
     * @param {string} groupKey
     * @returns {Promise<number>}
     */
    async distinctCountAsync({collection, query, groupKey}) {
        /**
         * @type {import('mongodb').AggregationCursor<import('mongodb').Document>}
         */
        const result = await collection.aggregate(
            [
                {
                    $match: query
                },
                {
                    $group: {
                        _id: '$' + `${groupKey}`
                    }
                },
                {
                    $count: 'total'
                }
            ],
            {
                allowDiskUse: true // sorting can be expensive
            }
        );
        /**
         * @type {import('mongodb').Document[]}
         */
        const documents = await result.toArray();
        return documents.length > 0 ? documents[0]['total'] : 0;
    }

    /**
     * Does a count of records after applying the filter
     * @param {import('mongodb').Collection} collection
     * @param {import('mongodb').Filter<import('mongodb').Document>} query
     * @returns {Promise<number|null>}
     */
    async countDocumentsWithFilterAsync({collection, query}) {
        /**
         * @type {import('mongodb').AggregationCursor<import('mongodb').Document>}
         */
        const result = await collection.aggregate(
            [
                {
                    $match: query
                },
                {
                    $count: 'total'
                }
            ],
            {
                allowDiskUse: true // sorting can be expensive
            }
        );
        /**
         * @type {import('mongodb').Document[]}
         */
        const documents = await result.toArray();
        return documents.length > 0 ? documents[0]['total'] : 0;
    }

    /**
     * Gets duplicate items by groupKey
     * @param {import('mongodb').Collection} collection
     * @param {import('mongodb').Filter<import('mongodb').Document>} query
     * @param {string} groupKey
     * @param {number|undefined} [limit]
     * @returns {Promise<{name: string, count: number}[]>}
     */
    async getDuplicateItems({collection, query, groupKey, limit = 100000000}) {
        /**
         * @type {import('mongodb').AggregationCursor<import('mongodb').Document>}
         */
        const result = await collection.aggregate(
            [
                {
                    $match: query
                },
                {
                    $limit: limit
                },
                {
                    $group: {
                        _id: '$' + `${groupKey}`,
                        count: {$sum: 1}
                    }
                },
                {
                    $match: {
                        _id: {$ne: null},
                        count: {$gt: 1}
                    }
                },
                {
                    $project: {
                        name: '$_id',
                        count: '$count',
                        _id: 0
                    }
                }
            ],
            {
                allowDiskUse: true // sorting can be expensive
            }
        );
        /**
         * @type {import('mongodb').Document[]}
         */
        const documents = await result.toArray();
        return documents.map(x => {
            return {name: x.name, count: x.count};
        });
    }

    /**
     * remove all documents in the collection but leave the collection
     * @param {import('mongodb').Db} db
     * @param {string} collectionName
     * @return {Promise<import('mongodb').DeleteResult>}
     */
    async clearCollectionAsync({db, collectionName}) {
        /**
         * @type {Collection<Document>}
         */
        const collection = await this.getOrCreateCollectionAsync({db, collectionName});
        return await collection.deleteMany({});
    }
}

module.exports = {
    MongoCollectionManager
};
