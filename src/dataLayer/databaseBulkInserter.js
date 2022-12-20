'use strict';
const async = require('async');
const env = require('var');
const sendToS3 = require('../utils/aws-s3');
const {getFirstElementOrNull} = require('../utils/list.util');
const {EventEmitter} = require('events');
const {logVerboseAsync, logSystemErrorAsync, logTraceSystemEventAsync} = require('../operations/common/logging');
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
const BundleEntry = require('../fhir/classes/4_0_0/backbone_elements/bundleEntry');
const BundleRequest = require('../fhir/classes/4_0_0/backbone_elements/bundleRequest');
const {DatabaseUpdateFactory} = require('./databaseUpdateFactory');
const {ResourceMerger} = require('../operations/common/resourceMerger');

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
 * @typedef {('insert'|'replace')} OperationType
 **/

/**
 * @typedef BulkInsertUpdateEntry
 * @type {object}
 * @property {OperationType} operationType
 * @property {string} resourceType
 * @property {string} id
 * @property {Resource} resource
 * @property {import('mongodb').AnyBulkWriteOperation} operation
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
     * @param {DatabaseUpdateFactory} databaseUpdateFactory
     * @param {ResourceMerger} resourceMerger
     */
    constructor({
                    resourceManager,
                    postRequestProcessor,
                    errorReporter,
                    mongoCollectionManager,
                    resourceLocatorFactory,
                    changeEventProducer,
                    preSaveManager,
                    requestSpecificCache,
                    databaseUpdateFactory,
                    resourceMerger
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
        /**
         * @type {DatabaseUpdateFactory}
         */
        this.databaseUpdateFactory = databaseUpdateFactory;
        assertTypeEquals(databaseUpdateFactory, DatabaseUpdateFactory);

        /**
         * @type {ResourceMerger}
         */
        this.resourceMerger = resourceMerger;
        assertTypeEquals(resourceMerger, ResourceMerger);
    }

    /**
     * This map stores an entry per resourceType where the value is a list of operations to perform
     * on that resourceType
     * <resourceType, list of operations>
     * @param {string} requestId
     * @return {Map<string, BulkInsertUpdateEntry[]>}
     */
    getOperationsByResourceTypeMap({requestId}) {
        return this.requestSpecificCache.getMap({requestId, name: 'OperationsByResourceTypeMap'});
    }

    /**
     * This map stores an entry per resourceType where the value is a list of operations to perform
     * on that resourceType
     * <resourceType, list of operations>
     * @param {string} requestId
     * @return {Map<string, BulkInsertUpdateEntry[]>}
     */
    getHistoryOperationsByResourceTypeMap({requestId}) {
        return this.requestSpecificCache.getMap({requestId, name: 'HistoryOperationsByResourceTypeMap'});
    }

    /**
     * Adds an operation
     * @param {string} requestId
     * @param {string} resourceType
     * @param {Resource} resource
     * @param {OperationType} operationType
     * @param {import('mongodb').AnyBulkWriteOperation} operation
     * @private
     */
    addOperationForResourceType({requestId, resourceType, resource, operationType, operation}) {
        assertIsValid(requestId, 'requestId is null');
        assertIsValid(resourceType, `resourceType: ${resourceType} is null`);
        assertIsValid(resource, `resource: ${resource} is null`);
        assertIsValid(operation, `operation: ${operation} is null`);
        assertIsValid(!(operation.insertOne && operation.insertOne.document instanceof Resource));
        assertIsValid(!(operation.replaceOne && operation.replaceOne.replacement instanceof Resource));
        // If there is no entry for this collection then create one
        const operationsByResourceTypeMap = this.getOperationsByResourceTypeMap({requestId});
        if (!(operationsByResourceTypeMap.has(resourceType))) {
            operationsByResourceTypeMap.set(`${resourceType}`, []);
        }
        // add this operation to the list of operations for this collection
        operationsByResourceTypeMap.get(resourceType).push({
            id: resource.id,
            resourceType,
            resource,
            operation,
            operationType
        });
    }

    /**
     * Adds a history operation
     * @param {string} requestId
     * @param {string} resourceType
     * @param {Resource} resource
     * @param {OperationType} operationType
     * @param {import('mongodb').AnyBulkWriteOperation} operation
     * @private
     */
    addHistoryOperationForResourceType({requestId, resourceType, resource, operationType, operation}) {
        // If there is no entry for this collection then create one
        const historyOperationsByResourceTypeMap = this.getHistoryOperationsByResourceTypeMap({requestId});
        if (!(historyOperationsByResourceTypeMap.has(resourceType))) {
            historyOperationsByResourceTypeMap.set(`${resourceType}`, []);
        }
        // add this operation to the list of operations for this collection
        historyOperationsByResourceTypeMap.get(resourceType).push({
            id: resource.id,
            resourceType,
            resource,
            operation,
            operationType
        });
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
            /**
             * @type {Map<string, BulkInsertUpdateEntry[]>}
             */
            const operationsByResourceTypeMap = this.getOperationsByResourceTypeMap({requestId});
            /**
             * @type {BulkInsertUpdateEntry[]}
             */
            const operationsByResourceType = operationsByResourceTypeMap.get(resourceType);
            if (operationsByResourceType &&
                operationsByResourceType.filter(
                    bulkEntry => bulkEntry.id === doc.id &&
                        bulkEntry.operationType === 'insert').length > 0) {
                const previousVersionId = 1;
                await this.replaceOneAsync(
                    {
                        requestId,
                        resourceType, id: doc.id, doc,
                        previousVersionId: `${previousVersionId}`
                    }
                );
            } else {
                // else insert it
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
                    resource: doc,
                    operation: {
                        insertOne: {
                            document: doc.toJSONInternal()
                        }
                    },
                    operationType: 'insert'
                });
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
        } catch (e) {
            throw new RethrownError({
                error: e
            });
        }
    }

    /**
     * Inserts item into history collection
     * @param {string} requestId
     * @param {string} method
     * @param {string} base_version
     * @param {string} resourceType
     * @param {Resource} doc
     * @returns {Promise<void>}
     */
    async insertOneHistoryAsync({requestId, method, base_version, resourceType, doc}) {
        try {
            assertTypeEquals(doc, Resource);
            this.addHistoryOperationForResourceType({
                    requestId,
                    resourceType,
                    resource: doc,
                    operationType: 'insert',
                    operation: {
                        insertOne: {
                            document: new BundleEntry(
                                {
                                    id: doc.id,
                                    resource: doc,
                                    request: new BundleRequest(
                                        {
                                            id: requestId,
                                            method,
                                            url: `/${base_version}/${resourceType}/${doc.id}`
                                        }
                                    )
                                }
                            ).toJSONInternal()
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
     * @param {string|null} previousVersionId
     * @param {Resource} doc
     * @param {boolean} [upsert]
     * @returns {Promise<void>}
     */
    async replaceOneAsync({requestId, resourceType, id, previousVersionId, doc, upsert = false}) {
        try {
            assertTypeEquals(doc, Resource);
            await this.preSaveManager.preSaveAsync(doc);

            // see if there are any other pending updates for this doc
            /**
             * @type {BulkInsertUpdateEntry[]}
             */
            const pendingUpdates = this.getPendingUpdates({requestId, resourceType})
                .filter(a => a.id === doc.id);
            /**
             * @type {BulkInsertUpdateEntry|null}
             */
            const previousUpdate = pendingUpdates.length > 0 ? pendingUpdates[pendingUpdates.length - 1] : null;
            if (previousUpdate) {
                /**
                 * @type {Resource}
                 */
                const previousResource = previousUpdate.resource;
                previousVersionId = previousResource.meta.versionId;
                doc = await this.resourceMerger.mergeResourceAsync({
                    currentResource: previousResource,
                    resourceToMerge: doc
                });
            } else {
                /**
                 * @type {BulkInsertUpdateEntry[]}
                 */
                const pendingInserts = this.getPendingInserts({requestId, resourceType})
                    .filter(a => a.id === doc.id);
                /**
                 * @type {BulkInsertUpdateEntry|null}
                 */
                const previousInsert = pendingInserts.length > 0 ? pendingInserts[pendingInserts.length - 1] : null;
                if (previousInsert) {
                    /**
                     * @type {Resource}
                     */
                    const previousResource = previousInsert.resource;
                    previousVersionId = previousResource.meta.versionId;
                    doc = await this.resourceMerger.mergeResourceAsync({
                        currentResource: previousResource,
                        resourceToMerge: doc
                    });
                }
            }

            // https://www.mongodb.com/docs/manual/reference/method/db.collection.bulkWrite/#mongodb-method-db.collection.bulkWrite
            // noinspection JSCheckFunctionSignatures
            const filter = previousVersionId && previousVersionId !== '0' ?
                {$and: [{id: id.toString()}, {'meta.versionId': `${previousVersionId}`}]} :
                {id: id.toString()};
            this.addOperationForResourceType({
                    requestId,
                    resourceType,
                    resource: doc,
                    operationType: 'replace',
                    operation: {
                        replaceOne: {
                            filter: filter,
                            upsert: upsert,
                            replacement: doc.toJSONInternal()
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
     * Executes all the operations in bulk
     * @param {string} base_version
     * @param {string} requestId
     * @param {string} currentDate
     * @returns {Promise<MergeResultEntry[]>}
     */
    async executeAsync({requestId, currentDate, base_version}) {
        assertIsValid(requestId, 'requestId is null');
        try {
            /**
             * @type {Map<string, BulkInsertUpdateEntry[]>}
             */
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
                async mapEntry => await this.performBulkForResourceTypeWithMapEntryAsync(
                    {
                        requestId, currentDate,
                        mapEntry: mapEntry,
                        base_version,
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
                     * @type {BulkInsertUpdateEntry[]}
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
            for (const [resourceType, operations] of operationsByResourceTypeMap.entries()) {
                /**
                 * @type {BulkResultEntry|null}
                 */
                const mergeResultForResourceType = getFirstElementOrNull(
                    resultsByResourceType.filter(r => r.resourceType === resourceType));
                if (mergeResultForResourceType) {
                    const diagnostics = JSON.stringify(mergeResultForResourceType.error);
                    for (const {id, resource, operationType} of operations) {
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
                        mergeResultEntries.push(mergeResultEntry);
                        // fire change events
                        this.postRequestProcessor.add({
                            requestId,
                            fnTask: async () => await this.changeEventProducer.fireEventsAsync({
                                requestId,
                                eventType: operationType === 'insert' ? 'C' : 'U',
                                resourceType: resourceType,
                                doc: resource
                            })
                        });
                    }
                }
            }
            operationsByResourceTypeMap.clear();
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
     * @param {[string, BulkInsertUpdateEntry[]]} mapEntry
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
                /** @type {BulkInsertUpdateEntry[]} */ operations
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
     * @param {BulkInsertUpdateEntry[]} operations
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
                 * @type {Map<string, BulkInsertUpdateEntry[]>}
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
                for (const /** @type {BulkInsertUpdateEntry} */ operation of operations) {
                    /**
                     * @type {Resource}
                     */
                    const resource = operation.resource;
                    assertIsValid(resource, 'resource is null');
                    /**
                     * @type {string}
                     */
                    const collectionName = useHistoryCollection ?
                        await resourceLocator.getHistoryCollectionNameAsync(resource.resource ? resource.resource : resource) :
                        await resourceLocator.getCollectionNameAsync(resource);
                    if (!(operationsByCollectionNames.has(collectionName))) {
                        operationsByCollectionNames.set(`${collectionName}`, []);
                    }
                    // remove _id if present so mongo can insert properly
                    if (!useHistoryCollection && operation.operationType === 'insert') {
                        delete operation.operation.insertOne.document['_id'];
                    }
                    if (!useHistoryCollection && resource._id) {
                        await this.errorReporter.reportMessageAsync({
                            source: 'DatabaseBulkInserter.performBulkForResourceTypeAsync',
                            message: '_id still present',
                            args: {
                                doc: resource,
                                collection: collectionName,
                                operation
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
                        /** @type {BulkInsertUpdateEntry[]} */
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
                        // const expectedInserts = this.getPendingInserts(operationsByCollection).length;
                        const expectedUpdates = this.getPendingUpdates({requestId, resourceType}).length;
                        /**
                         * @type {(import('mongodb').AnyBulkWriteOperation)[]}
                         */
                        const bulkOperations = operationsByCollection.map(o => o.operation);
                        await logTraceSystemEventAsync(
                            {
                                event: 'bulkWrite',
                                message: 'Begin Bulk Write',
                                args: {
                                    resourceType,
                                    collectionName,
                                    operationsByCollection
                                }
                            }
                        );
                        /**
                         * @type {import('mongodb').BulkWriteOpResultObject}
                         */
                        const result = await collection.bulkWrite(bulkOperations, options);
                        //TODO: this only returns result from the last collection
                        mergeResult = result.result;
                        // const actualInserts = mergeResult.nInserted;
                        const actualUpdates = mergeResult.nModified;
                        // if updates don't match then get latest and merge again
                        if (actualUpdates < expectedUpdates) {
                            await logTraceSystemEventAsync(
                                {
                                    event: 'bulkWrite',
                                    message: 'Update count not matched so running updates one by one',
                                    args: {
                                        resourceType,
                                        collectionName,
                                        operationsByCollection,
                                        actualUpdates,
                                        expectedUpdates
                                    }
                                }
                            );
                            await this.updateResourcesOneByOne({operationsByCollection});
                        }
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

    /**
     * Gets list of pending inserts for this resourceType
     * @param {string} requestId
     * @param {string} resourceType
     * @returns {BulkInsertUpdateEntry[]}
     */
    getPendingInserts({requestId, resourceType}) {
        /**
         * @type {BulkInsertUpdateEntry[]|undefined}
         */
        const operationsByResourceType = this.getOperationsByResourceTypeMap({requestId}).get(resourceType);
        return operationsByResourceType ? operationsByResourceType.filter(operation => operation.operationType === 'insert') : [];
    }

    /**
     * Gets list of pending updates for this resourceType
     * @param {string} requestId
     * @param {string} resourceType
     * @returns {BulkInsertUpdateEntry[]}
     */
    getPendingUpdates({requestId, resourceType}) {
        /**
         * @type {BulkInsertUpdateEntry[]|undefined}
         */
        const operationsByResourceType = this.getOperationsByResourceTypeMap({requestId}).get(resourceType);
        return operationsByResourceType ? operationsByResourceType.filter(operation => operation.operationType === 'replace') : [];
    }

    /**
     * Updates resources one by one
     * @param {BulkInsertUpdateEntry[]} operationsByCollection
     * @returns {Promise<void>}
     */
    async updateResourcesOneByOne({operationsByCollection}) {
        // find the resources
        /**
         * @type {Resource[]}
         */
        const updateResources = operationsByCollection.filter(operation => operation.operationType === 'replace')
            .map(operation => operation.resource);

        for (const /* @type {Object} */ updateResource of updateResources) {
            /**
             * @type {DatabaseUpdateManager}
             */
            const databaseUpdateManager = this.databaseUpdateFactory.createDatabaseUpdateManager(
                {
                    resourceType: updateResource.resourceType,
                    base_version: '4_0_0'
                }
            );
            await databaseUpdateManager.replaceOneAsync({doc: updateResource});
        }
    }
}

module.exports = {
    DatabaseBulkInserter
};
