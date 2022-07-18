const {getOrCreateCollection} = require('../../utils/mongoCollectionManager');
const globals = require('../../globals');
const {AUDIT_EVENT_CLIENT_DB, ATLAS_CLIENT_DB, CLIENT_DB} = require('../../constants');

class DatabaseBulkInserter {
    constructor() {
        // https://www.mongodb.com/docs/drivers/node/current/usage-examples/bulkWrite/
        /**
         * This map stores an entry per collectionName where the value is a list of operations to perform
         * on that collection
         * @type {Map<string, (import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]>}
         */
        this.operationsByCollection = new Map();
        /**
         * list of ids inserted
         * @type {Map<string, string[]>}
         */
        this.insertedIdsByCollection = new Map();
        /**
         * list of ids updated
         * @type {Map<string, string[]>}
         */
        this.updatedIdsByCollection = new Map();
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
            this.insertedIdsByCollection.set(`${collection_name}`, []);
            this.updatedIdsByCollection.set(`${collection_name}`, []);
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
    async insertOneAsync(collection_name, doc) {
        this.addOperationToCollection(collection_name,
            {
                insertOne: {
                    document: doc
                }
            }
        );
        this.insertedIdsByCollection.get(collection_name).push(doc['id']);
    }

    /**
     * Replaces a document in Mongo with this one
     * @param {string} collection_name
     * @param {string} id
     * @param {Object} doc
     * @returns {Promise<void>}
     */
    async replaceOneAsync(collection_name, id, doc) {
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
        this.updatedIdsByCollection.get(collection_name).push(doc['id']);
    }

    /**
     * Executes all the operations in bulk
     * @param {boolean?} useAtlas
     * @returns {Promise<MergeResultEntry[]>}
     */
    async executeAsync(useAtlas) {
        /**
         * stores result of bulk calls
         * @type {Map<string, import('mongodb').BulkWriteOpResultObject>}
         */
        const resultByCollection = new Map();
        // iterate through each collection and issue a bulk operation
        for (const [
            /** @type {string} */collectionName,
            /** @type {(import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]} */ operations] of this.operationsByCollection.entries()) {
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
            // for some reason the typing does
            /**
             * @type {import('mongodb').CollectionBulkWriteOptions}
             */
            const options = {ordered: false};
            // noinspection JSValidateTypes,JSVoidFunctionReturnValueUsed,JSCheckFunctionSignatures
            /**
             * @type {import('mongodb').BulkWriteOpResultObject}
             */
            const result = await collection.bulkWrite(operations, options);
            resultByCollection.set(collectionName, result.result);
        }
        /**
         * results
         * @type {MergeResultEntry[]}
         */
        const mergeResultEntries = [];
        for (const [, ids] of this.insertedIdsByCollection) {
            for (const id of ids) {
                mergeResultEntries.push(
                    {
                        'id': id,
                        created: true,
                        updated: false,
                        operationOutcome: null,
                        issue: null
                    }
                );
            }
        }
        for (const [, ids] of this.updatedIdsByCollection) {
            for (const id of ids) {
                mergeResultEntries.push(
                    {
                        'id': id,
                        created: false,
                        updated: true,
                        operationOutcome: null,
                        issue: null
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
