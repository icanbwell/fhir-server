const {getOrCreateCollection} = require('../../utils/mongoCollectionManager');
const globals = require('../../globals');
const {AUDIT_EVENT_CLIENT_DB, ATLAS_CLIENT_DB, CLIENT_DB} = require('../../constants');

class DatabaseBulkInserter {
    constructor() {
        // https://www.mongodb.com/docs/drivers/node/current/usage-examples/bulkWrite/
        /**
         * This map stores an entry per collectionName where the value is a list of operations to perform
         * on that collection
         * @type {Map<string, (import('mongodb').BulkWriteOperation<DefaultSchema>)[]>}
         */
        this.operationsByCollection = new Map();
    }

    /**
     * Adds operation
     * @param {string} collection_name
     * @param {import('mongodb').BulkWriteOperation<DefaultSchema>} operation
     */
    addOperationToCollection(collection_name, operation) {
        // If there is no entry for this collection then create one
        if (!(collection_name in this.operationsByCollection)) {
            this.operationsByCollection.set(`${collection_name}`, []);
        }
        // add this operation to the list of operations for this collection
        this.operationsByCollection.get(collection_name).push(operation);
    }

    /**
     * Inserts item into collection
     * @param {string} collection_name
     * @param {Object} doc
     * @returns {Promise<void>}
     */
    async insertOne(collection_name, doc) {
        this.addOperationToCollection(collection_name,
            {
                insertOne: {
                    document: doc
                }
            }
        );
    }

    /**
     * Replaces a document in Mongo with this one
     * @param {string} collection_name
     * @param {string} id
     * @param {Object} doc
     * @returns {Promise<void>}
     */
    async replaceOne(collection_name, id, doc) {
        // https://www.mongodb.com/docs/manual/reference/method/db.collection.bulkWrite/#mongodb-method-db.collection.bulkWrite
        this.addOperationToCollection(collection_name,
            {
                replaceOne: {
                    filter: {id: id.toString()},
                    // upsert: true,
                    replacement: doc
                }
            }
        );
    }

    /**
     * Executes all the operations in bulk
     * @param {boolean?} useAtlas
     * @returns {Promise<MergeResultEntry[]>}
     */
    async execute(useAtlas) {
        /**
         * stores result of bulk calls
         * @type {Map<string, import('mongodb').BulkWriteOpResultObject>}
         */
        const resultByCollection = new Map();
        // iterate through each collection and issue a bulk operation
        for (const [
            /** @type {string} */collectionName,
            /** @type (import('mongodb').BulkWriteOperation<DefaultSchema>)[] */ operations] of this.operationsByCollection.entries()) {
            /**
             * mongo db connection
             * @type {import('mongodb').Db}
             */
            let db = (collectionName === 'AuditEvent_4_0_0') ?
                globals.get(AUDIT_EVENT_CLIENT_DB) : (useAtlas && globals.has(ATLAS_CLIENT_DB)) ?
                    globals.get(ATLAS_CLIENT_DB) : globals.get(CLIENT_DB);
            /**
             * @type {import('mongodb').Collection}
             */
            let collection = await getOrCreateCollection(db, collectionName);
            // TODO: Handle failures in bulk operation
            /**
             * @type {import('mongodb').BulkWriteOpResultObject}
             */
            const result = await collection.bulkWrite(operations);
            resultByCollection.set(collectionName, result.result);
        }
        this.operationsByCollection.clear();
        /**
         * results
         * @type {MergeResultEntry[]}
         */
        const mergeResultEntries = [];
        for (const [, result] of resultByCollection) {
            for (const resultEntry of result.insertedIds) {
                mergeResultEntries.push(
                    {
                        id: resultEntry,
                        created: true
                    }
                );
            }
            for (const resultEntry of result.upserted) {
                mergeResultEntries.push(
                    {
                        id: resultEntry,
                        updated: true
                    }
                );
            }
        }
        return mergeResultEntries;
    }
}

module.exports = {
    DatabaseBulkInserter
};
