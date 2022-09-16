'use strict';
const async = require('async');
const env = require('var');
const sendToS3 = require('../utils/aws-s3');
const {getFirstElementOrNull} = require('../utils/list.util');
const {EventEmitter} = require('events');
const {logVerboseAsync, logSystemErrorAsync} = require('../operations/common/logging');
const {ResourceManager} = require('../operations/common/resourceManager');
const {PostRequestProcessor} = require('../utils/postRequestProcessor');
const {ErrorReporter} = require('../utils/slack.logger');
const {MongoCollectionManager} = require('../utils/mongoCollectionManager');
const {ResourceLocatorFactory} = require('../operations/common/resourceLocatorFactory');
const {assertTypeEquals, assertIsValid} = require('../utils/assertType');
const {ChangeEventProducer} = require('../utils/changeEventProducer');
const OperationOutcomeIssue = require('../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const CodeableConcept = require('../fhir/classes/4_0_0/complex_types/codeableConcept');
const Resource = require('../fhir/classes/4_0_0/resources/resource');

const Mutex = require('async-mutex').Mutex;
const mutex = new Mutex();

/**
 * @typedef BulkResultEntry
 * @type {object}
 * @property {string} resourceType
 * @property {import('mongodb').BulkWriteOpResultObject|null} mergeResult
 * @property {Error|null} error
 */


/**
 * This class accepts inserts and updates and when executeAsync() is called it sends them to Mongo in bulk
 */
class DatabaseBulkInserter extends EventEmitter {
    /**
     * Constructor
     * @param {ResourceManager} resourceManager
     * @param {PostRequestProcessor} postRequestProcessor
     * @param {ErrorReporter} errorReporter
     * @param {MongoCollectionManager} collectionManager
     * @param {ResourceLocatorFactory} resourceLocatorFactory
     * @param {ChangeEventProducer} changeEventProducer
     */
    constructor({
                    resourceManager, postRequestProcessor, errorReporter,
                    collectionManager, resourceLocatorFactory,
                    changeEventProducer
                }) {
        super();

        /**
         * @type {ResourceManager}
         */
        this.resourceManager = resourceManager;
        assertTypeEquals(resourceManager, ResourceManager);

        /**
         * @type {PostRequestProcessor}
         */
        this.postRequestProcessor = postRequestProcessor;
        assertTypeEquals(postRequestProcessor, PostRequestProcessor);

        /**
         * @type {ErrorReporter}
         */
        this.errorReporter = errorReporter;
        assertTypeEquals(errorReporter, ErrorReporter);

        /**
         * @type {MongoCollectionManager}
         */
        this.collectionManager = collectionManager;
        assertTypeEquals(collectionManager, MongoCollectionManager);

        /**
         * @type {ResourceLocatorFactory}
         */
        this.resourceLocatorFactory = resourceLocatorFactory;
        assertTypeEquals(resourceLocatorFactory, ResourceLocatorFactory);

        /**
         * @type {ChangeEventProducer}
         */
        this.changeEventProducer = changeEventProducer;
        assertTypeEquals(changeEventProducer, ChangeEventProducer);

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
     * @private
     */
    addOperationForResourceType({resourceType, operation}) {
        assertIsValid(resourceType, `resourceType: ${resourceType} is null`);
        assertIsValid(operation, `operation: ${operation} is null`);
        assertIsValid(!(operation.insertOne && operation.insertOne.document instanceof Resource));
        assertIsValid(!(operation.replaceOne && operation.replaceOne.replacement instanceof Resource));
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
     * @private
     */
    addHistoryOperationForResourceType({resourceType, operation}) {
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
     * @param {Resource} doc
     * @returns {Promise<void>}
     */
    async insertOneAsync({resourceType, doc}) {
        assertTypeEquals(doc, Resource);
        // check to see if we already have this insert and if so use replace
        if (this.insertedIdsByResourceTypeMap.get(resourceType) &&
            this.insertedIdsByResourceTypeMap.get(resourceType).filter(a => a.id === doc.id).length > 0) {
            return await this.replaceOneAsync(
                {
                    resourceType, id: doc.id, doc
                }
            );
        }
        if (doc._id) {
            this.errorReporter.reportMessageAsync({
                source: 'DatabaseBulkInserter.insertOneAsync',
                message: '_id still present',
                args: {
                    doc: doc
                }
            });
        }
        // else insert it
        await logVerboseAsync({
            source: 'DatabaseBulkInserter.insertOneAsync',
            args:
                {
                    message: 'start',
                    bufferLength: this.operationsByResourceTypeMap.size
                }
        });
        this.addOperationForResourceType({
                resourceType,
                operation: {
                    insertOne: {
                        document: doc.toJSONInternal()
                    }
                }
            }
        );
        this.insertedIdsByResourceTypeMap.get(resourceType).push(doc.id);
    }

    /**
     * Inserts item into history collection
     * @param {string} resourceType
     * @param {Resource} doc
     * @returns {Promise<void>}
     */
    async insertOneHistoryAsync({resourceType, doc}) {
        assertTypeEquals(doc, Resource);
        this.addHistoryOperationForResourceType({
                resourceType,
                operation: {
                    insertOne: {
                        document: doc.toJSONInternal()
                    }
                }
            }
        );
    }

    /**
     * Replaces a document in Mongo with this one
     * @param {string} resourceType
     * @param {string} id
     * @param {Resource} doc
     * @returns {Promise<void>}
     */
    async replaceOneAsync({resourceType, id, doc}) {
        assertTypeEquals(doc, Resource);
        // https://www.mongodb.com/docs/manual/reference/method/db.collection.bulkWrite/#mongodb-method-db.collection.bulkWrite
        // noinspection JSCheckFunctionSignatures
        this.addOperationForResourceType({
                resourceType,
                operation: {
                    replaceOne: {
                        filter: {id: id.toString()},
                        // upsert: true,
                        replacement: doc.toJSONInternal()
                    }
                }
            }
        );
        this.updatedIdsByResourceTypeMap.get(resourceType).push(doc.id);
    }

    /**
     * Executes all the operations in bulk
     * @param {string} base_version
     * @param {boolean?} useAtlas
     * @param {string} requestId
     * @param {string} currentDate
     * @returns {Promise<MergeResultEntry[]>}
     */
    async executeAsync({requestId, currentDate, base_version, useAtlas}) {
        await logVerboseAsync({
            source: 'DatabaseBulkInserter.executeAsync',
            args:
                {
                    message: 'start',
                    bufferLength: this.operationsByResourceTypeMap.size
                }
        });
        // run both the operations on the main tables and the history tables in parallel
        /**
         * @type {BulkResultEntry[]}
         */
        const resultsByResourceType = await async.map(
            this.operationsByResourceTypeMap.entries(),
            async x => await this.performBulkForResourceTypeWithMapEntryAsync(
                {
                    requestId, currentDate,
                    mapEntry: x, base_version, useAtlas,
                    useHistoryCollection: false
                }
            ));

        if (this.historyOperationsByResourceTypeMap.size > 0) {
            this.postRequestProcessor.add(async () => {
                    await async.map(
                        this.historyOperationsByResourceTypeMap.entries(),
                        async x => await this.performBulkForResourceTypeWithMapEntryAsync(
                            {
                                requestId, currentDate,
                                mapEntry: x, base_version, useAtlas,
                                useHistoryCollection: true
                            }
                        ));
                    this.historyOperationsByResourceTypeMap.clear();
                }
            );
        }

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
                await this.errorReporter.reportErrorAsync(
                    {
                        source: 'databaseBulkInserter',
                        message: `databaseBulkInserter: Error resource ${erroredMerge.resourceType} with operations:` +
                            ` ${JSON.stringify(operationsForResourceType)}`,
                        error: erroredMerge.error,
                        args: {
                            requestId: requestId,
                            resourceType: erroredMerge.resourceType,
                            operations: operationsForResourceType
                        }
                    }
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
                        mergeResultEntry.issue = new OperationOutcomeIssue({
                            severity: 'error',
                            code: 'exception',
                            details: new CodeableConcept({text: mergeResultForResourceType.error.message}),
                            diagnostics: diagnostics,
                            expression: [
                                resourceType + '/' + id
                            ]
                        });
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

                    await this.changeEventProducer.fireEventsAsync({
                        requestId,
                        eventType: 'C',
                        resourceType: resourceType,
                        doc: resource
                    });
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
                        mergeResultEntry.issue = new OperationOutcomeIssue({
                            severity: 'error',
                            code: 'exception',
                            details: new CodeableConcept({text: mergeResultForResourceType.error.message}),
                            diagnostics: diagnostics,
                            expression: [
                                resourceType + '/' + id
                            ]
                        });
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
                    await this.changeEventProducer.fireEventsAsync({
                        requestId,
                        eventType: 'U',
                        resourceType: resourceType,
                        doc: resource
                    });
                }
            }
        }

        this.operationsByResourceTypeMap.clear();
        this.insertedIdsByResourceTypeMap.clear();
        this.updatedIdsByResourceTypeMap.clear();

        await logVerboseAsync({
            source: 'DatabaseBulkInserter.executeAsync',
            args:
                {
                    message: 'end',
                    bufferLength: this.operationsByResourceTypeMap.size
                }
        });
        return mergeResultEntries;
    }

    /**
     * Performs bulk operations
     * @param {string} requestId
     * @param {string} currentDate
     * @param {[string, (import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]]} mapEntry
     * @param {string} base_version
     * @param {boolean|null} useAtlas
     * @param {boolean|null} useHistoryCollection
     * @returns {Promise<BulkResultEntry>}
     */
    async performBulkForResourceTypeWithMapEntryAsync(
        {
            requestId,
            currentDate,
            mapEntry, base_version,
            useAtlas, useHistoryCollection
        }
    ) {
        const [
            /** @type {string} */resourceType,
            /** @type {(import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]} */ operations
        ] = mapEntry;

        return await this.performBulkForResourceTypeAsync(
            {
                requestId, currentDate,
                resourceType, base_version, useAtlas, useHistoryCollection, operations
            });
    }

    /**
     * Run bulk operations for collection of resourceType
     * @param {string} requestId
     * @param {string} currentDate
     * @param {string} resourceType
     * @param {string} base_version
     * @param {boolean} useAtlas
     * @param {boolean|null} useHistoryCollection
     * @param {(import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]} operations
     * @returns {Promise<BulkResultEntry>}
     */
    async performBulkForResourceTypeAsync(
        {
            requestId,
            currentDate,
            resourceType,
            base_version,
            useAtlas,
            useHistoryCollection,
            operations
        }) {
        return await mutex.runExclusive(async () => {
            /**
             * @type {Map<string, *[]>}
             */
            const operationsByCollectionNames = new Map();
            /**
             * @type {ResourceLocator}
             */
            const resourceLocator = this.resourceLocatorFactory.createResourceLocator(
                {
                    resourceType, base_version, useAtlas
                }
            );
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
                    await resourceLocator.getHistoryCollectionNameAsync(resource) :
                    await resourceLocator.getCollectionNameAsync(resource);
                if (!(operationsByCollectionNames.has(collectionName))) {
                    operationsByCollectionNames.set(`${collectionName}`, []);
                }
                // remove _id if present so mongo can insert properly
                if (!useHistoryCollection && operation.insertOne) {
                    delete operation.insertOne.document['_id'];
                }
                if (!useHistoryCollection && resource._id) {
                    this.errorReporter.reportMessageAsync({
                        source: 'DatabaseBulkInserter.performBulkForResourceTypeAsync',
                        message: '_id still present',
                        args: {
                            doc: resource,
                            collection: collectionName,
                            insert: operation.insertOne
                        }
                    });
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
                        currentDate,
                        requestId,
                        'merge');
                }
                try {
                    /**
                     * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>}
                     */
                    const collection = await resourceLocator.getOrCreateCollectionAsync(collectionName);
                    /**
                     * @type {import('mongodb').BulkWriteOpResultObject}
                     */
                    const result = await collection.bulkWrite(operationsByCollection, options);
                    //TODO: this only returns result from the last collection
                    mergeResult = result.result;
                } catch (e) {
                    await this.errorReporter.reportErrorAsync({
                        source: 'databaseBulkInserter',
                        message: 'databaseBulkInserter: Error bulkWrite',
                        error: e,
                        args: {
                            requestId: requestId,
                            operations: operationsByCollection,
                            options: options,
                            collection: collectionName
                        }
                    });
                    await logSystemErrorAsync({
                        event: 'databaseBulkInserter',
                        message: 'databaseBulkInserter: Error bulkWrite',
                        error: e,
                        args: {
                            requestId: requestId,
                            operations: operationsByCollection,
                            options: options,
                            collection: collectionName
                        }
                    });
                    return {resourceType: resourceType, mergeResult: null, error: e};
                }
            }
            return {resourceType: resourceType, mergeResult: mergeResult, error: null};
        });
    }
}

module.exports = {
    DatabaseBulkInserter
};
