const {
    getOrCreateCollectionForResourceTypeAsync,
    getOrCreateHistoryCollectionForResourceTypeAsync
} = require('../operations/common/resourceManager');
const async = require('async');

/**
 * This class accepts inserts and updates and when execute() is called it sends them to Mongo in bulk
 */
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
         * This map stores an entry per resourceType where the value is a list of operations to perform
         * on that resourceType
         * <resourceType, list of operations>
         * @type {Map<string, (import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]>}
         */
        this.historyOperationsByResourceType = new Map();
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
     * Adds an operation
     * @param {string} resourceType
     * @param {import('mongodb').BulkWriteOperation<DefaultSchema>} operation
     */
    addOperationForResourceType(resourceType, operation) {
        // If there is no entry for this collection then create one
        if (!(this.operationsByResourceType.has(resourceType))) {
            this.operationsByResourceType.set(`${resourceType}`, []);
            this.insertedIdsByResourceType.set(`${resourceType}`, []);
            this.updatedIdsByResourceType.set(`${resourceType}`, []);
        }
        // add this operation to the list of operations for this collection
        this.operationsByResourceType.get(resourceType).push(operation);
    }

    /**
     * Adds a history operation
     * @param {string} resourceType
     * @param {import('mongodb').BulkWriteOperation<DefaultSchema>} operation
     */
    addHistoryOperationForResourceType(resourceType, operation) {
        // If there is no entry for this collection then create one
        if (!(this.historyOperationsByResourceType.has(resourceType))) {
            this.historyOperationsByResourceType.set(`${resourceType}`, []);
        }
        // add this operation to the list of operations for this collection
        this.historyOperationsByResourceType.get(resourceType).push(operation);
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
     * Inserts item into history collection
     * @param {string} resourceType
     * @param {Object} doc
     * @returns {Promise<void>}
     */
    async insertOneHistoryAsync(resourceType, doc) {
        this.addHistoryOperationForResourceType(resourceType,
            {
                insertOne: {
                    document: doc
                }
            }
        );
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
     * @param {string} base_version
     * @param {boolean?} useAtlas
     * @returns {Promise<MergeResultEntry[]>}
     */
    async executeAsync(base_version, useAtlas) {
        // run both the operations on the main tables and the history tables in parallel
        await Promise.all([
            async.map(this.operationsByResourceType.entries(), async x => await this.performBulkForResourceTypeWithMapEntry(
                x, base_version, useAtlas
            )),
            async.map(this.historyOperationsByResourceType.entries(), async x => await this.performBulkForResourceTypeHistoryWithMapEntry(
                x, base_version, useAtlas
            ))
        ]);

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

    /**
     * Run bulk operations for history collection of resourceType
     * @param {[string, (import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]]} mapEntry
     * @param {string} base_version
     * @param {boolean} useAtlas
     * @return {Promise<void>}
     */
    async performBulkForResourceTypeHistoryWithMapEntry(mapEntry, base_version, useAtlas) {
        const [
            /** @type {string} */resourceType,
            /** @type {(import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]} */ operations] = mapEntry;

        return await this.performBulkForResourceTypeHistory(resourceType, base_version, useAtlas, operations);
    }

    /**
     * Run bulk operations for history collection of resourceType
     * @param {string} resourceType
     * @param {string} base_version
     * @param {boolean} useAtlas
     * @param {(import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]} operations
     * @returns {Promise<void>}
     */
    async performBulkForResourceTypeHistory(resourceType, base_version, useAtlas, operations) {
        const collection = await getOrCreateHistoryCollectionForResourceTypeAsync(resourceType, base_version, useAtlas);
        // TODO: Handle failures in bulk operation
        // no need to preserve order for history entries since each is an insert
        /**
         * @type {import('mongodb').CollectionBulkWriteOptions}
         */
        const options = {ordered: false};
        // lint gets confused by the two signatures of this method
        // noinspection JSValidateTypes,JSVoidFunctionReturnValueUsed,JSCheckFunctionSignatures
        await collection.bulkWrite(operations, options);
    }

    /**
     * Performs bulk operations
     * @param {[string, (import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]]} mapEntry
     * @param base_version
     * @param useAtlas
     * @return {Promise<{resourceType: string, mergeResult: import('mongodb').BulkWriteOpResultObject}>}
     */
    async performBulkForResourceTypeWithMapEntry(mapEntry, base_version, useAtlas) {
        const [
            /** @type {string} */resourceType,
            /** @type {(import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]} */ operations] = mapEntry;

        return await this.performBulkForResourceType(resourceType, base_version, useAtlas, operations);
    }

    /**
     * Run bulk operations for collection of resourceType
     * @param {string} resourceType
     * @param {string} base_version
     * @param {boolean} useAtlas
     * @param {(import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]} operations
     * @returns {Promise<{resourceType: string, mergeResult: import('mongodb').BulkWriteOpResultObject}>}
     */
    async performBulkForResourceType(resourceType, base_version, useAtlas, operations) {
        const collection = await getOrCreateCollectionForResourceTypeAsync(resourceType, base_version, useAtlas);

        // TODO: Handle failures in bulk operation
        // preserve order so inserts come before updates
        /**
         * @type {import('mongodb').CollectionBulkWriteOptions}
         */
        const options = {ordered: true};
        // noinspection JSValidateTypes,JSVoidFunctionReturnValueUsed,JSCheckFunctionSignatures
        /**
         * @type {import('mongodb').BulkWriteOpResultObject}
         */
        const result = await collection.bulkWrite(operations, options);
        return {resourceType: resourceType, mergeResult: result.result};
    }
}

module.exports = {
    DatabaseBulkInserter
};
