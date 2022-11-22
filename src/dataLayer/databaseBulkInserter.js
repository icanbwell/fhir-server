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
const {RethrownError} = require('../utils/rethrownError');
const {isTrue} = require('../utils/isTrue');
const {databaseBulkInserterTimer} = require('../utils/prometheus.utils');
const {PreSaveManager} = require('../preSaveHandlers/preSave');
const {RequestSpecificCache} = require('../utils/requestSpecificCache');

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
     * @param {MongoCollectionManager} mongoCollectionManager
     * @param {ResourceLocatorFactory} resourceLocatorFactory
     * @param {ChangeEventProducer} changeEventProducer
     * @param {PreSaveManager} preSaveManager
     * @param {RequestSpecificCache} requestSpecificCache
     */
    constructor({
                    resourceManager,
                    postRequestProcessor,
                    errorReporter,
                    mongoCollectionManager,
                    resourceLocatorFactory,
                    changeEventProducer,
                    preSaveManager,
                    requestSpecificCache
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
        this.mongoCollectionManager = mongoCollectionManager;
        assertTypeEquals(mongoCollectionManager, MongoCollectionManager);

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

        /**
         * @type {PreSaveManager}
         */
        this.preSaveManager = preSaveManager;
        assertTypeEquals(preSaveManager, PreSaveManager);

        // https://www.mongodb.com/docs/drivers/node/current/usage-examples/bulkWrite/

        /**
         * @type {RequestSpecificCache}
         */
        this.requestSpecificCache = requestSpecificCache;
        assertTypeEquals(requestSpecificCache, RequestSpecificCache);
    }

    /**
     * This map stores an entry per resourceType where the value is a list of operations to perform
     * on that resourceType
     * <resourceType, list of operations>
     * @param {string} requestId
     * @return {Map<string, (import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]>}
     */
    getOperationsByResourceTypeMap({requestId}) {
        return this.requestSpecificCache.getMap({requestId, name: 'OperationsByResourceTypeMap'});
    }

    /**
     * This map stores an entry per resourceType where the value is a list of operations to perform
     * on that resourceType
     * <resourceType, list of operations>
     * @param {string} requestId
     * @return {Map<string, (import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]>}
     */
    getHistoryOperationsByResourceTypeMap({requestId}) {
        return this.requestSpecificCache.getMap({requestId, name: 'HistoryOperationsByResourceTypeMap'});
    }

    /**
     * @param {string} requestId
     * @return {Map<string, string[]>}
     */
    getInsertedIdsByResourceTypeMap({requestId}) {
        return this.requestSpecificCache.getMap({requestId, name: 'InsertedIdsByResourceTypeMap'});
    }

    /**
     * @param {string} requestId
     * @return {Map<string, string[]>}
     */
    getUpdatedIdsByResourceTypeMap({requestId}) {
        return this.requestSpecificCache.getMap({requestId, name: 'UpdatedIdsByResourceTypeMap'});
    }


    /**
     * Adds an operation
     * @param {string} requestId
     * @param {string} resourceType
     * @param {import('mongodb').BulkWriteOperation<DefaultSchema>} operation
     * @private
     */
    addOperationForResourceType({requestId, resourceType, operation}) {
        assertIsValid(requestId, 'requestId is null');
        assertIsValid(resourceType, `resourceType: ${resourceType} is null`);
        assertIsValid(operation, `operation: ${operation} is null`);
        assertIsValid(!(operation.insertOne && operation.insertOne.document instanceof Resource));
        assertIsValid(!(operation.replaceOne && operation.replaceOne.replacement instanceof Resource));
        // If there is no entry for this collection then create one
        const operationsByResourceTypeMap = this.getOperationsByResourceTypeMap({requestId});
        if (!(operationsByResourceTypeMap.has(resourceType))) {
            operationsByResourceTypeMap.set(`${resourceType}`, []);
            const insertedIdsByResourceTypeMap = this.getInsertedIdsByResourceTypeMap({requestId});
            insertedIdsByResourceTypeMap.set(`${resourceType}`, []);
            const updatedIdsByResourceTypeMap = this.getUpdatedIdsByResourceTypeMap({requestId});
            updatedIdsByResourceTypeMap.set(`${resourceType}`, []);
        }
        // add this operation to the list of operations for this collection
        operationsByResourceTypeMap.get(resourceType).push(operation);
    }

    /**
     * Adds a history operation
     * @param {string} requestId
     * @param {string} resourceType
     * @param {import('mongodb').BulkWriteOperation<DefaultSchema>} operation
     * @private
     */
    addHistoryOperationForResourceType({requestId, resourceType, operation}) {
        // If there is no entry for this collection then create one
        const historyOperationsByResourceTypeMap = this.getHistoryOperationsByResourceTypeMap({requestId});
        if (!(historyOperationsByResourceTypeMap.has(resourceType))) {
            historyOperationsByResourceTypeMap.set(`${resourceType}`, []);
        }
        // add this operation to the list of operations for this collection
        historyOperationsByResourceTypeMap.get(resourceType).push(operation);
    }

    /**
     * Inserts item into collection
     * @param {string} requestId
     * @param {string} resourceType
     * @param {Resource} doc
     * @returns {Promise<void>}
     */
    async insertOneAsync({requestId, resourceType, doc}) {
        try {
            assertTypeEquals(doc, Resource);
            await this.preSaveManager.preSaveAsync(doc);
            // check to see if we already have this insert and if so use replace
            const insertedIdsByResourceTypeMap = this.getInsertedIdsByResourceTypeMap({requestId});
            if (insertedIdsByResourceTypeMap.get(resourceType) &&
                insertedIdsByResourceTypeMap.get(resourceType).filter(a => a.id === doc.id).length > 0) {
                return await this.replaceOneAsync(
                    {
                        requestId,
                        resourceType, id: doc.id, doc
                    }
                );
            }
            if (doc._id) {
                await this.errorReporter.reportMessageAsync({
                    source: 'DatabaseBulkInserter.insertOneAsync',
                    message: '_id still present',
                    args: {
                        doc: doc
                    }
                });
            }
            // else insert it
            const operationsByResourceTypeMap = this.getOperationsByResourceTypeMap({requestId});
            await logVerboseAsync({
                source: 'DatabaseBulkInserter.insertOneAsync',
                args:
                    {
                        message: 'start',
                        bufferLength: operationsByResourceTypeMap.size
                    }
            });
            this.addOperationForResourceType({
                    requestId,
                    resourceType,
                    operation: {
                        insertOne: {
                            document: doc.toJSONInternal()
                        }
                    }
                }
            );
            insertedIdsByResourceTypeMap.get(resourceType).push(doc.id);
        } catch (e) {
            throw new RethrownError({
                error: e
            });
        }
    }

    /**
     * Inserts item into history collection
     * @param {string} requestId
     * @param {string} resourceType
     * @param {Resource} doc
     * @returns {Promise<void>}
     */
    async insertOneHistoryAsync({requestId, resourceType, doc}) {
        try {
            assertTypeEquals(doc, Resource);
            this.addHistoryOperationForResourceType({
                    requestId,
                    resourceType,
                    operation: {
                        insertOne: {
                            document: doc.toJSONInternal()
                        }
                    }
                }
            );
        } catch (e) {
            throw new RethrownError({
                error: e
            });
        }
    }

    /**
     * Replaces a document in Mongo with this one
     * @param {string} requestId
     * @param {string} resourceType
     * @param {string} id
     * @param {Resource} doc
     * @param {boolean} [upsert]
     * @returns {Promise<void>}
     */
    async replaceOneAsync({requestId, resourceType, id, doc, upsert = false}) {
        try {
            assertTypeEquals(doc, Resource);
            await this.preSaveManager.preSaveAsync(doc);
            // https://www.mongodb.com/docs/manual/reference/method/db.collection.bulkWrite/#mongodb-method-db.collection.bulkWrite
            // noinspection JSCheckFunctionSignatures
            this.addOperationForResourceType({
                    requestId,
                    resourceType,
                    operation: {
                        replaceOne: {
                            filter: {id: id.toString()},
                            upsert: upsert,
                            replacement: doc.toJSONInternal()
                        }
                    }
                }
            );
            const updatedIdsByResourceTypeMap = this.getUpdatedIdsByResourceTypeMap({requestId});
            updatedIdsByResourceTypeMap.get(resourceType).push(doc.id);
        } catch (e) {
            throw new RethrownError({
                error: e
            });
        }
    }

    /**
     * Executes all the operations in bulk
     * @param {string} base_version
     * @param {string} requestId
     * @param {string} currentDate
     * @returns {Promise<MergeResultEntry[]>}
     */
    async executeAsync({requestId, currentDate, base_version}) {
        try {
            const operationsByResourceTypeMap = this.getOperationsByResourceTypeMap({requestId});
            await logVerboseAsync({
                source: 'DatabaseBulkInserter.executeAsync',
                args:
                    {
                        message: 'start',
                        bufferLength: operationsByResourceTypeMap.size
                    }
            });
            // run both the operations on the main tables and the history tables in parallel
            /**
             * @type {BulkResultEntry[]}
             */
            const resultsByResourceType = await async.map(
                operationsByResourceTypeMap.entries(),
                async x => await this.performBulkForResourceTypeWithMapEntryAsync(
                    {
                        requestId, currentDate,
                        mapEntry: x, base_version,
                        useHistoryCollection: false
                    }
                ));

            const historyOperationsByResourceTypeMap = this.getHistoryOperationsByResourceTypeMap({requestId});
            if (historyOperationsByResourceTypeMap.size > 0) {
                this.postRequestProcessor.add({
                        requestId,
                        fnTask: async () => {
                            await async.map(
                                historyOperationsByResourceTypeMap.entries(),
                                async x => await this.performBulkForResourceTypeWithMapEntryAsync(
                                    {
                                        requestId, currentDate,
                                        mapEntry: x, base_version,
                                        useHistoryCollection: true
                                    }
                                ));
                            historyOperationsByResourceTypeMap.clear();
                        }
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
                    const operationsForResourceType = operationsByResourceTypeMap.get(erroredMerge.resourceType);
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
            const insertedIdsByResourceTypeMap = this.getInsertedIdsByResourceTypeMap({requestId});
            for (const [resourceType, ids] of insertedIdsByResourceTypeMap) {
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
                        const resource = operationsByResourceTypeMap
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
            const updatedIdsByResourceTypeMap = this.getUpdatedIdsByResourceTypeMap({requestId});
            for (const [resourceType, ids] of updatedIdsByResourceTypeMap) {
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
                        const resources = operationsByResourceTypeMap
                            .get(resourceType);
                        if (resources !== undefined) {
                            /**
                             * @type {Resource}
                             */
                            const resource = resources
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
            }

            operationsByResourceTypeMap.clear();
            insertedIdsByResourceTypeMap.clear();
            updatedIdsByResourceTypeMap.clear();

            await logVerboseAsync({
                source: 'DatabaseBulkInserter.executeAsync',
                args:
                    {
                        message: 'end',
                        bufferLength: operationsByResourceTypeMap.size
                    }
            });
            return mergeResultEntries;
        } catch (e) {
            throw new RethrownError({
                error: e
            });
        }
    }

    /**
     * Performs bulk operations
     * @param {string} requestId
     * @param {string} currentDate
     * @param {[string, (import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]]} mapEntry
     * @param {string} base_version
     * @param {boolean|null} useHistoryCollection
     * @returns {Promise<BulkResultEntry>}
     */
    async performBulkForResourceTypeWithMapEntryAsync(
        {
            requestId,
            currentDate,
            mapEntry, base_version,
            useHistoryCollection
        }
    ) {
        try {
            const [
                /** @type {string} */resourceType,
                /** @type {(import('mongodb').BulkWriteOperation<import('mongodb').DefaultSchema>)[]} */ operations
            ] = mapEntry;

            return await this.performBulkForResourceTypeAsync(
                {
                    requestId, currentDate,
                    resourceType, base_version, useHistoryCollection, operations
                });
        } catch (e) {
            throw new RethrownError({
                error: e
            });
        }
    }

    /**
     * Run bulk operations for collection of resourceType
     * @param {string} requestId
     * @param {string} currentDate
     * @param {string} resourceType
     * @param {string} base_version
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
            useHistoryCollection,
            operations
        }) {
        // Start the FHIR request timer, saving a reference to the returned method
        const timer = databaseBulkInserterTimer.startTimer();
        try {
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
                        resourceType, base_version
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
                        await this.errorReporter.reportMessageAsync({
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
                 * @type {import('mongodb').BulkWriteOptions|null}
                 */
                const options = {ordered: true};
                /**
                 * @type {import('mongodb').BulkWriteOpResultObject|null}
                 */
                let mergeResult;
                for (const operationsByCollectionName of operationsByCollectionNames) {
                    const [
                        /** @type {string} */collectionName,
                        /** @type {(import('mongodb').AnyBulkWriteOperation<import('mongodb').DefaultSchema>)[]} */
                        operationsByCollection] = operationsByCollectionName;

                    if (isTrue(env.LOG_ALL_MERGES)) {
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
        } catch (e) {
            throw new RethrownError({
                error: e
            });
        } finally {
            timer({resourceType});
        }
    }
}

module.exports = {
    DatabaseBulkInserter
};
