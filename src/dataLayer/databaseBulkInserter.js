'use strict';
const {ResourceLocator} = require('../operations/common/resourceLocator');
const async = require('async');
const env = require('var');
const sendToS3 = require('../utils/aws-s3');
const {getFirstElementOrNull} = require('../utils/list.util');
const {logErrorToSlackAsync} = require('../utils/slack.logger');
const {EventEmitter} = require('events');
const {ResourceManager} = require('../operations/common/resourceManager');

/**
 * @typedef BulkResultEntry
 * @type {object}
 * @property {string} resourceType
 * @property {import('mongodb').BulkWriteOpResultObject|null} mergeResult
 * @property {Error|null} error
 */


/**
 * This class accepts inserts and updates and when execute() is called it sends them to Mongo in bulk
 */
class DatabaseBulkInserter extends EventEmitter {
    /**
     * Constructor
     * @param {string} requestId
     * @param {string} currentDate
     */
    constructor(requestId, currentDate) {
        super();
        /**
         * @type {string}
         */
        this.requestId = requestId;
        /**
         * @type {string}
         */
        this.currentDate = currentDate;
        // https://www.mongodb.com/docs/drivers/node/current/usage-examples/bulkWrite/
        /**
         * This map stores an entry per resourceType where the value is a list of operations to perform
         * on that resourceType
         * <resourceType, list of operations>
         * @type {Map<string, (import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]>}
         */
        this.operationsByResourceTypeMap = new Map();
        /**
         * This map stores an entry per resourceType where the value is a list of operations to perform
         * on that resourceType
         * <resourceType, list of operations>
         * @type {Map<string, (import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]>}
         */
        this.historyOperationsByResourceTypeMap = new Map();
        /**
         * list of ids inserted
         * <resourceType, list of ids>
         * @type {Map<string, string[]>}
         */
        this.insertedIdsByResourceTypeMap = new Map();
        /**
         * list of ids updated
         * <resourceType, list of ids>
         * @type {Map<string, string[]>}
         */
        this.updatedIdsByResourceTypeMap = new Map();
    }

    /**
     * Adds an operation
     * @param {string} resourceType
     * @param {import('mongodb').BulkWriteOperation<DefaultSchema>} operation
     */
    addOperationForResourceType(resourceType, operation) {
        // If there is no entry for this collection then create one
        if (!(this.operationsByResourceTypeMap.has(resourceType))) {
            this.operationsByResourceTypeMap.set(`${resourceType}`, []);
            this.insertedIdsByResourceTypeMap.set(`${resourceType}`, []);
            this.updatedIdsByResourceTypeMap.set(`${resourceType}`, []);
        }
        // add this operation to the list of operations for this collection
        this.operationsByResourceTypeMap.get(resourceType).push(operation);
    }

    /**
     * Adds a history operation
     * @param {string} resourceType
     * @param {import('mongodb').BulkWriteOperation<DefaultSchema>} operation
     */
    addHistoryOperationForResourceType(resourceType, operation) {
        // If there is no entry for this collection then create one
        if (!(this.historyOperationsByResourceTypeMap.has(resourceType))) {
            this.historyOperationsByResourceTypeMap.set(`${resourceType}`, []);
        }
        // add this operation to the list of operations for this collection
        this.historyOperationsByResourceTypeMap.get(resourceType).push(operation);
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
        this.insertedIdsByResourceTypeMap.get(resourceType).push(doc.id);
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
        this.updatedIdsByResourceTypeMap.get(resourceType).push(doc.id);
    }

    /**
     * Executes all the operations in bulk
     * @param {string} base_version
     * @param {boolean?} useAtlas
     * @returns {Promise<MergeResultEntry[]>}
     */
    async executeAsync(base_version, useAtlas) {
        // run both the operations on the main tables and the history tables in parallel
        /**
         * @type {BulkResultEntry[]}
         */
        const resultsByResourceType = await async.map(
            this.operationsByResourceTypeMap.entries(),
            async x => await this.performBulkForResourceTypeWithMapEntryAsync(
                x, base_version, useAtlas, false
            ));

        // TODO: For now, we are ignoring errors saving history
        await async.map(
            this.historyOperationsByResourceTypeMap.entries(),
            async x => await this.performBulkForResourceTypeWithMapEntryAsync(
                x, base_version, useAtlas, true
            ));

        // If there are any errors, send them to Slack notification
        if (resultsByResourceType.some(r => r.error)) {
            /**
             * @type {BulkResultEntry[]}
             */
            const erroredMerges = resultsByResourceType.filter(r => r.error);
            for (const erroredMerge of erroredMerges) {
                /**
                 * @type {import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>[]}
                 */
                const operationsForResourceType = this.operationsByResourceTypeMap.get(erroredMerge.resourceType);
                await logErrorToSlackAsync(
                    `databaseBulkInserter: Error resource ${erroredMerge.resourceType} with operations:` +
                    ` ${JSON.stringify(operationsForResourceType)}`,
                    erroredMerge.error
                );
            }
        }
        /**
         * results
         * @type {MergeResultEntry[]}
         */
        const mergeResultEntries = [];
        for (const [resourceType, ids] of this.insertedIdsByResourceTypeMap) {
            /**
             * @type {BulkResultEntry|null}
             */
            const mergeResultForResourceType = getFirstElementOrNull(
                resultsByResourceType.filter(r => r.resourceType === resourceType));
            if (mergeResultForResourceType) {
                const diagnostics = JSON.stringify(mergeResultForResourceType.error);
                for (const id of ids) {
                    /**
                     * @type {MergeResultEntry}
                     */
                    const mergeResultEntry = {
                        'id': id,
                        created: !mergeResultForResourceType.error,
                        updated: false,
                        resourceType: resourceType
                    };
                    if (mergeResultForResourceType.error) {
                        mergeResultEntry.issue = {
                            severity: 'error',
                            code: 'exception',
                            details: {text: mergeResultForResourceType.error.message},
                            diagnostics: diagnostics,
                            expression: [
                                resourceType + '/' + id
                            ]
                        };
                    }
                    mergeResultEntries.push(
                        mergeResultEntry
                    );
                    // fire change events
                    /**
                     * @type {Resource}
                     */
                    const resource = this.operationsByResourceTypeMap
                        .get(resourceType)
                        .filter(x => x.insertOne && x.insertOne.document.id === id)[0].insertOne.document;
                    /**
                     * @type {string|null}
                     */
                    const patientId = await ResourceManager.getPatientIdFromResourceAsync(resourceType, resource);
                    if (patientId) {
                        if (resourceType === 'Patient') {
                            this.emit('createPatient', {id: patientId, resourceType: resourceType, resource: resource});
                        } else {
                            this.emit('changePatient', {id: patientId, resourceType: resourceType, resource: resource});
                        }
                    }
                    this.emit('insertResource', {id: id, resourceType: resourceType, resource: resource});
                }
            }
        }
        for (const [resourceType, ids] of this.updatedIdsByResourceTypeMap) {
            /**
             * @type {BulkResultEntry|null}
             */
            const mergeResultForResourceType = getFirstElementOrNull(resultsByResourceType.filter(r => r.resourceType === resourceType));
            if (mergeResultForResourceType) {
                const diagnostics = JSON.stringify(mergeResultForResourceType.error);
                for (const id of ids) {
                    /**
                     * @type {MergeResultEntry}
                     */
                    const mergeResultEntry = {
                        'id': id,
                        created: false,
                        updated: !mergeResultForResourceType.error,
                        resourceType: resourceType
                    };
                    if (mergeResultForResourceType.error) {
                        mergeResultEntry.issue = {
                            severity: 'error',
                            code: 'exception',
                            details: {text: mergeResultForResourceType.error.message},
                            diagnostics: diagnostics,
                            expression: [
                                resourceType + '/' + id
                            ]
                        };
                    }
                    mergeResultEntries.push(
                        mergeResultEntry
                    );
                    /**
                     * @type {Resource}
                     */
                    const resource = this.operationsByResourceTypeMap
                        .get(resourceType)
                        .filter(x => x.replaceOne && x.replaceOne.replacement.id === id)[0].replaceOne.replacement;
                    /**
                     * @type {string|null}
                     */
                    const patientId = await ResourceManager.getPatientIdFromResourceAsync(resourceType, resource);
                    if (patientId) {
                        this.emit('changePatient', {id: patientId, resourceType: resourceType, resource: resource});
                    }
                    this.emit('updateResource', {id: id, resourceType: resourceType, resource: resource});
                }
            }
        }
        return mergeResultEntries;
    }

    /**
     * Performs bulk operations
     * @param {[string, (import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]]} mapEntry
     * @param {string} base_version
     * @param {boolean|null} useAtlas
     * @param {boolean|null} useHistoryCollection
     * @returns {Promise<BulkResultEntry>}
     */
    async performBulkForResourceTypeWithMapEntryAsync(mapEntry, base_version,
                                                      useAtlas, useHistoryCollection) {
        const [
            /** @type {string} */resourceType,
            /** @type {(import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]} */ operations
        ] = mapEntry;

        return await this.performBulkForResourceTypeAsync(resourceType, base_version, useAtlas, useHistoryCollection, operations);
    }

    /**
     * Run bulk operations for collection of resourceType
     * @param {string} resourceType
     * @param {string} base_version
     * @param {boolean} useAtlas
     * @param {boolean|null} useHistoryCollection
     * @param {(import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]} operations
     * @returns {Promise<BulkResultEntry>}
     */
    async performBulkForResourceTypeAsync(resourceType, base_version, useAtlas,
                                          useHistoryCollection, operations) {
        /**
         * @type {Map<string, *[]>}
         */
        const operationsByCollectionNames = new Map();
        for (const /** @type {import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>} */ operation of operations) {
            // noinspection JSValidateTypes
            /**
             * @type {Resource}
             */
            const resource = operation.insertOne ? operation.insertOne.document : operation.replaceOne.replacement;
            /**
             * @type {string}
             */
            const collectionName = useHistoryCollection ?
                new ResourceLocator(resourceType, base_version, useAtlas).getHistoryCollectionName(resource) :
                new ResourceLocator(resourceType, base_version, useAtlas).getCollectionName(resource);
            if (!(operationsByCollectionNames.has(collectionName))) {
                operationsByCollectionNames.set(`${collectionName}`, []);
            }
            operationsByCollectionNames.get(collectionName).push(operation);
        }

        // preserve order so inserts come before updates
        /**
         * @type {import('mongodb').CollectionBulkWriteOptions|null}
         */
        const options = {ordered: true};
        /**
         * @type {import('mongodb').BulkWriteOpResultObject|null}
         */
        let mergeResult;
        for (const operationsByCollectionName of operationsByCollectionNames) {
            const [
                /** @type {string} */collectionName,
                /** @type {(import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]} */
                operationsByCollection] = operationsByCollectionName;

            if (env.LOG_ALL_MERGES) {
                await sendToS3('bulk_inserter',
                    resourceType,
                    operations,
                    this.currentDate,
                    this.requestId,
                    'merge');
            }
            try {
                /**
                 * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>}
                 */
                const collection = await new ResourceLocator(resourceType, base_version, useAtlas)
                    .getOrCreateCollectionAsync(collectionName);
                /**
                 * @type {import('mongodb').BulkWriteOpResultObject}
                 */
                const result = await collection.bulkWrite(operationsByCollection, options);
                //TODO: this only returns result from the last collection
                mergeResult = result.result;
            } catch (e) {
                return {resourceType: resourceType, mergeResult: null, error: e};
            }
        }
        return {resourceType: resourceType, mergeResult: mergeResult, error: null};
    }
}

module.exports = {
    DatabaseBulkInserter
};
