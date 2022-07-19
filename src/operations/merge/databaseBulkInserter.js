const {getOrCreateCollection} = require('../../utils/mongoCollectionManager');
const {getCollectionNameForResourceType, getDatabaseConnectionForCollection} = require('../common/resourceManager');

class DatabaseBulkInserter {
    constructor() {
        // https://www.mongodb.com/docs/drivers/node/current/usage-examples/bulkWrite/
        /**
         * This map stores an entry per resourceType where the value is a list of operations to perform
         * on that resourceType
         * <resourceType, list of operations>
         * @type {Map<string, (import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]>}
         */
        this.operationsByResourceType = new Map();
        /**
         * list of ids inserted
         * <resourceType, list of ids>
         * @type {Map<string, string[]>}
         */
        this.insertedIdsByResourceType = new Map();
        /**
         * list of ids updated
         * <resourceType, list of ids>
         * @type {Map<string, string[]>}
         */
        this.updatedIdsByResourceType = new Map();
    }

    /**
     * Adds operation
     * @param {string} resourceType
     * @param {import('mongodb').BulkWriteOperation<DefaultSchema>} operation
     */
    addOperationForResourceType(resourceType, operation) {
        // If there is no entry for this collection then create one
        if (!(resourceType in this.operationsByResourceType)) {
            this.operationsByResourceType.set(`${resourceType}`, []);
            this.insertedIdsByResourceType.set(`${resourceType}`, []);
            this.updatedIdsByResourceType.set(`${resourceType}`, []);
        }
        // add this operation to the list of operations for this collection
        this.operationsByResourceType.get(resourceType).push(operation);
    }

    /**
     * Inserts item into collection
     * @param {string} resourceType
     * @param {Object} doc
     * @returns {Promise<void>}
     */
    async insertOneAsync(resourceType, doc) {
        this.addOperationForResourceType(resourceType,
            {
                insertOne: {
                    document: doc
                }
            }
        );
        this.insertedIdsByResourceType.get(resourceType).push(doc['id']);
    }

    /**
     * Replaces a document in Mongo with this one
     * @param {string} resourceType
     * @param {string} id
     * @param {Object} doc
     * @returns {Promise<void>}
     */
    async replaceOneAsync(resourceType, id, doc) {
        // https://www.mongodb.com/docs/manual/reference/method/db.collection.bulkWrite/#mongodb-method-db.collection.bulkWrite
        this.addOperationForResourceType(resourceType,
            {
                replaceOne: {
                    filter: {id: id.toString()},
                    // upsert: true,
                    replacement: doc
                }
            }
        );
        this.updatedIdsByResourceType.get(resourceType).push(doc['id']);
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
        const resultByResourceType = new Map();
        // iterate through each collection and issue a bulk operation
        for (const [
            /** @type {string} */resourceType,
            /** @type {(import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]} */ operations] of this.operationsByResourceType.entries()) {
            /**
             * @type {string}
             */
            const collectionName = getCollectionNameForResourceType(resourceType);
            /**
             * mongo db connection
             * @type {import('mongodb').Db}
             */
            const db = getDatabaseConnectionForCollection(collectionName, useAtlas);
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
            resultByResourceType.set(resourceType, result.result);
        }
        /**
         * results
         * @type {MergeResultEntry[]}
         */
        const mergeResultEntries = [];
        for (const [resourceType, ids] of this.insertedIdsByResourceType) {
            for (const id of ids) {
                mergeResultEntries.push(
                    {
                        'id': id,
                        created: true,
                        updated: false,
                        operationOutcome: null,
                        issue: null,
                        resourceType: resourceType
                    }
                );
            }
        }
        for (const [resourceType, ids] of this.updatedIdsByResourceType) {
            for (const id of ids) {
                mergeResultEntries.push(
                    {
                        'id': id,
                        created: false,
                        updated: true,
                        operationOutcome: null,
                        issue: null,
                        resourceType: resourceType
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
